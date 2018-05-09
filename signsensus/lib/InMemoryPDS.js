
var cutil   = require("./consUtil");
var ssutil  = require("./ssutil");


function Storage(parentStorage){

    var cset            = {};  // containes all keys in parent storage, contains only keys touched in handlers
    var writeSet        = !parentStorage ? cset : {};   //contains only keys modified in handlers

    var readSetVersions  = {}; //meaningful only in handlers
    var writeSetVersions = {}; //will store all versions generated by writeKey

    var vsd             = "empty"; //only for parent storage

    var self = this;


    function hasLocalKey(name){
        return cset.hasOwnProperty(name);
    }

    this.hasKey = function(name){
        return parentStorage ? parentStorage.hasKey(name) : hasLocalKey(name);
    }

    this.readKey = function readKey(name){
        var value = undefined;
        if(hasLocalKey(name)){
            value = cset[name];
        }else{
            if(this.hasKey(name)){
                value = parentStorage.readKey(name);
                cset[name] = value;
                readSetVersions[name] = parentStorage.getVersion(name);
            }else{
                cset[name] = undefined;
                readSetVersions[name] = 0;
            }
            writeSetVersions[name] = readSetVersions[name];
        }
        return value;
    }

    this.getVersion = function(name, realVersion){
        var version = 0;
        if(hasLocalKey(name)){
            version = readSetVersions[name];
        }else{
            if(this.hasKey(name)){
                cset[name] = parentStorage.readKey();
                version = readSetVersions[name] = parentStorage.getVersion(name);
            }else{
                cset[name] = undefined;
                readSetVersions[name] = version;
            }
        }
        return version;
    }

    this.writeKey = function modifyKey(name, value){
        var k = this.readKey(name);

        cset [name] = value;
        writeSetVersions[name]++;
        writeSet[name] = value;
    }

    this.getInputOutput = function () {
        return {
            input: readSetVersions,
            output: writeSet
        }
    }

    this.getInternalValues = function(){
        return {
            cset:cset,
            writeSetVersions:writeSetVersions,
            vsd:vsd
        }
    }

    function applyTransaction(t){
        for(var k in t.output){
            if(!t.input.hasOwnProperty(k)){
                return false;
            }
        }
        for(var k in t.input){
            var transactionVersion = t.input[k];
            var currentVersion = self.getVersion(k);
            if(transactionVersion != currentVersion){
                //console.log(k, transactionVersion , currentVersion);
                return false;
            }
        }

        for(var k in t.output){
            self.writeKey(k, t.output[k]);
        }

		var arr = process.hrtime();
		var current_second = arr[0];
		var diff = current_second-t.second;

		global["Tranzactions_Time"]+=diff;

		return true;
    }

    this.computePTBlock = function(nextBlockSet){   //make a transactions block from nextBlockSet by removing invalid transactions from the key versions point of view
        var validBlock = [];
        var orderedByTime = cutil.orderTransactions(nextBlockSet);
        var i = 0;

        while(i < orderedByTime.length){
            var t = orderedByTime[i];
            if(applyTransaction(t)){
                validBlock.push(t.digest);
            }
            i++;
        }
        return validBlock;
    }

    this.commit = function(blockSet){
        var i = 0;
        var orderedByTime = cutil.orderTransactions(blockSet);

        while(i < orderedByTime.length){
            var t = orderedByTime[i];
            if(!applyTransaction(t)){ //paranoid check,  fail to work if a majority is corrupted
                //pretty bad
                //throw new Error("Failed to commit an invalid block. This could be a nasty bug or the stakeholders majority is corrupted! It should never happen!");
                console.log("Failed to commit an invalid block. This could be a nasty bug or the stakeholders majority is corrupted! It should never happen!"); //TODO: replace with better error handling
            }
            i++;
        }
        this.getVSD(true);
    }

    this.getVSD = function(forceCalculation){
        if(forceCalculation){
            var tmp = this.getInternalValues();
            vsd = ssutil.hashValues(tmp);
        }
        return vsd;
    }
}

function InMemoryPDS(storage, diskPersistence, shareHoldersCount){

    var mainStorage = new Storage(storage);
    if(!shareHoldersCount) {
        //console.log("Setting shareHoldersCount to 1")
        shareHoldersCount = 1;
    }

    this.getHandler = function(){ // a way to work with PDS
        var tempStorage = new Storage(mainStorage);
        return tempStorage;
    }

    this.computeSwarmTransactionDiff = function(swarm, forkedPds){
        var inpOutp     = forkedPds.getInputOutput();
        swarm.input     = inpOutp.input;
        swarm.output    = inpOutp.output;
        return swarm;
    }

    this.computePTBlock = function(nextBlockSet){
        var tempStorage = new Storage(mainStorage);
        return tempStorage.computePTBlock(nextBlockSet);

    }

    this.commit = function(blockSet){
        mainStorage.commit(blockSet);
    }

    this.getVSD = function (){
        return mainStorage.getVSD(false);
    }

    this.getShareHoldersVotingBox = function(){
       return  cutil.createDemocraticVotingBox(shareHoldersCount);
    }
}


exports.newPDS = function(numberOfStakeholders){
    return new InMemoryPDS(undefined, undefined, numberOfStakeholders);
}