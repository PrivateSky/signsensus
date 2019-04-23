var pskcrypto = require("pskcrypto");
var fs = require("fs");

var consUtil = require("./consUtil");

var detailedDebug = false;


var pulseSwarm = $$.flow.describe("pulseSwarm", {
    public: {
    },

    start: function (delegatedAgentName, communicationOutlet, pdsAdapter, pulsePeriodicity, votingBox) {
        this.nodeName               = delegatedAgentName;
        this.communicationOutlet    = communicationOutlet;
        this.pdsAdapter             = pdsAdapter;
        this.pulsePeriodicity       = pulsePeriodicity;

        this.votingBox = votingBox;

        this.currentPulse = 0;
        this.topPulseConsensus = 0;
        this.lastPulseAchievedConsensus = 0;


        this.lset = {}; // digest -> transaction - localy generated set of transactions (`createTransactionFromSwarm` stores each transaction; `beat` resets `lset`)
        this.dset = {}; // digest -> transaction - remotely delivered set of transactions that will be next participate in consensus
        this.pset = {}; // digest -> transaction - consensus pending set

        this.pulsesHistory = {};

        global["Tranzactions_Time"] = 0;        // used in "pskdb\lib\InMemoryPDS.js"

        this.vsd = this.pdsAdapter.getVSD();

        this.level = 0;
        this.commitCounter = 0;                 // "Total tranzactii comise"

        this.beat();
    },

    beat: function () {
        var ptBlock = null;
        var nextConsensusPulse = this.topPulseConsensus + 1;
        var majoritarianVSD = "none";

        while (nextConsensusPulse <= this.currentPulse) {
            ptBlock = consUtil.detectMajoritarianPTBlock(nextConsensusPulse, this.pulsesHistory, this.votingBox);
            majoritarianVSD = consUtil.detectMajoritarianVSD(nextConsensusPulse, this.pulsesHistory, this.votingBox);


            if (ptBlock != "none" && this.vsd == majoritarianVSD) {
                if (!this.hasAllTransactions(ptBlock)) {
                    this.print("Unknown transactions detected...")
                    break;
                }

                //console.log(this.nodeName, ptBlock.length,this.vsd, majoritarianVSD, nextConsensusPulse);

                if (ptBlock.length /*&& this.hasAllTransactions(ptBlock)*/) {
                    this.pset = consUtil.setsConcat(this.pset, this.dset);
                    this.dset = {};
                    var resultSet = consUtil.makeSetFromBlock(this.pset, ptBlock);

                    this.commitCounter += ptBlock.length;
                    //this.print("\t\tBlock [" + this.dumpPtBlock(ptBlock) + "] at pulse " + nextConsensusPulse + " and VSD " +  this.vsd.slice(0,8));

                    this.pdsAdapter.commit(resultSet);
                    this.level++;
                    //fs.writeFileSync(this.level+"-"+this.vsd+"-"+this.nodeName, JSON.stringify(resultSet));
                    var topDigest = ptBlock[ptBlock.length - 1];
                    this.topPulseConsensus = this.pset[topDigest].CP;
                    consUtil.setsRemovePtBlockAndPastTransactions(this.pset, ptBlock, this.topPulseConsensus); //cleanings
                    var oldVsd = this.vsd;
                    this.vsd = this.pdsAdapter.getVSD();

                    this.lastPulseAchievedConsensus = nextConsensusPulse;   //safer than `this.currentPulse`!?
                    //this.topPulseConsensus = nextConsensusPulse;

                    this.print("\t\t consensus at pulse " + nextConsensusPulse + " and VSD " + oldVsd.slice(0, 8));
                } else {
                    this.pset = consUtil.setsConcat(this.pset, this.dset);
                    this.dset = {};
                    this.lastPulseAchievedConsensus = nextConsensusPulse;   //safer than `this.currentPulse`!?
                    this.topPulseConsensus = nextConsensusPulse;
                    //this.print("\t\tEmpty " + " at: " + nextConsensusPulse );
                    //console.log("\t\tmajoritarian ", majoritarianVSD.slice(0,8) , nextConsensusPulse);
                }
                break; //exit WHILE

            } //end if (ptBlock != "none" && this.vsd == majoritarianVSD)

            nextConsensusPulse++;
        } //end while


        //daca nu a reusit,ar trebui sa vada daca nu exista un alt last majoritar
        ptBlock = this.pdsAdapter.computePTBlock(this.pset);

        var newPulse = consUtil.createPulse(
            this.nodeName,                          //==> Pulse.signer
            this.currentPulse,
            ptBlock,
            this.lset,
            this.vsd,
            this.topPulseConsensus,
            this.lastPulseAchievedConsensus);

        //console.log("\t\tPulse", this.nodeName, this.vsd.slice(0,8) );
        //this.print("Pulse" );
        this.recordPulse(this.nodeName, newPulse);

        var self = this;
        self.communicationOutlet.broadcastPulse(self.nodeName, newPulse);
        
        this.lset = {};
        this.currentPulse++;

        setTimeout(this.beat, this.pulsePeriodicity);   //self invocation of phase `beat`
    },

    hasAllTransactions: function (ptBlock) {
        for (var i = 0; i < ptBlock.length; i++) {
            var item = ptBlock[i];
            if (!this.pset.hasOwnProperty(item)) {
                return false;
            }
        }
        return true;
    },

    createTransactionFromSwarm: function (swarm) {
        var t = consUtil.createTransaction(this.currentPulse, swarm);
        this.lset[t.digest] = t;
        return t;
    },

    /**
     * 
     * @param {String} from e.g. this.nodeName a.k.a. delegatedAgentName
     * @param {Pulse} pulse e.g. new Pulse(this.nodeName, this.currentPulse, ......)
     */
    recordPulse: function (from, pulse) {
        if (!pulse.ptBlock) {
            pulse.ptBlock = [];
        }
        pulse.blockDigest = pskcrypto.hashValues(pulse.ptBlock);

        if (!this.pulsesHistory[pulse.currentPulse]) {
            this.pulsesHistory[pulse.currentPulse] = {};
        }
        this.pulsesHistory[pulse.currentPulse][from] = pulse;

        //console.log(pulse.top, from);
        /*
        var h = this.pulsesHistory[pulse.top];
        if (h) {
            var p = [from];
            if (p) {
                p.vsd = pulse.vsd;
            } else {
                console.log("-----------------------", pulse.top, from);
                this.pulsesHistory[pulse.top][from] = pulse;
            }
        }
        */

        if (pulse.currentPulse >= this.topPulseConsensus) {
            if (pulse.currentPulse <= this.lastPulseAchievedConsensus) {
                for (var d in pulse.lset) {
                    this.pset[d] = pulse.lset[d];// could still be important for consensus
                }
            } else {
                for (var d in pulse.lset) {
                    this.dset[d] = pulse.lset[d];
                }
            }
        }
        //TODO: ask for pulses that others received but we failed to receive
    },

    dumpPtBlock: function (ptBlock) {
        return ptBlock.map(function (item) {
            return item.slice(0, 8);
        }).join(" ");
    },
    exportStatistics: function () {
        return {
            "NUMBER_OF_TRANZACTIONS_PER_SEC": this.commitCounter / GLOBAL_MAX_TRANSACTION_TIME,
            "NUMBER_OF_PULSES": this.currentPulse,
            "TIME_TO_COMMIT_TRANZACTION": global["Tranzactions_Time"] / this.commitCounter
        };
    },
    dump: function () {
        // this.print("Final");
    },
    print: function (str) {
        if (!detailedDebug) {
            if (str === "Pulse") return;
        }

        if (!str) {
            str = "State "
        }

        function countSet(set) {
            var l = 0;
            for (var v in set) l++;
            return l;
        }

        console.log(this.nodeName, " | ", str, " | ",
            "currentPulse:", this.currentPulse, "top:", this.topPulseConsensus, "LPAC:", this.lastPulseAchievedConsensus, "VSD:", this.vsd.slice(0, 8),
            " | ", countSet(this.pset), countSet(this.dset), countSet(this.lset),
            " | ", this.commitCounter / GLOBAL_MAX_TRANSACTION_TIME, " tranzactii pe secunda. Total tranzactii comise:", this.commitCounter);

    },
    printState: function () {
        console.log(this.nodeName, ",", this.currentPulse, ",", this.vsd);
    },
    printPset: function () {
        function sortedDigests(set) {
            var res = [];
            for (var d in set) {
                res.push(d);
            }
            return pskcrypto.hashValues(res.sort());
        }
        function appendToCSV(filename, arr) {
            const reducer = (accumulator, currentValue) => accumulator + " , " + currentValue;
            var str = arr.reduce(reducer, "") + "\n";
            fs.appendFileSync(filename, str);
        }

        var arr = [
            this.nodeName,
            this.currentPulse,
            this.topPulseConsensus,
            this.lastPulseAchievedConsensus,
            sortedDigests(this.pset),
            sortedDigests(this.dset),
            sortedDigests(this.lset),
            this.vsd
        ];
        appendToCSV("data.csv", arr);
        // console.log(this.nodeName,",",this.currentPulse,",",Object.keys(this.pset).length);
    }
});


/**
 * @param {String} delegatedAgentName e.g. 'Node 0', or 'agent_007'
 * @param {Object} communicationOutlet e.g. object to be used in phase `beat` of the returned "pulseSwarm" flow
 *  - it should have a property: `broadcastPulse`: function(from, pulse) {...}
 *      - {String} `from` e.g. `delegatedAgentName`
 *      - {Pulse} `pulse` (see 'consUtil.js')
 * @param {InMemoryPDS} pdsAdapter e.g. require("pskdb/lib/InMemoryPDS").newPDS(null);
 * @param {Number} pulsePeriodicity e.g. 300
 * 
 * @returns {SwarmDescription} A new instance of "pulseSwarm" flow, with phase `start` already running
 */
exports.createConsensusManager = function (delegatedAgentName, communicationOutlet, pdsAdapter, pulsePeriodicity, votingBox) {
    var instance = pulseSwarm();
    instance.start(delegatedAgentName, communicationOutlet, pdsAdapter, pulsePeriodicity, votingBox);

    return instance;
}
