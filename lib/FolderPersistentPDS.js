var memoryPDS = require("./InMemoryPDS");
var fs = require("fs");


function FolderPersistentPDS(folder){
    this.memCache = memoryPDS.newPDS(this);

    function mkSignleLine(str){
        return str.replace(/\n|\r/g, "");
    }

    this.persist = function (transactionLog, internalValues, currentPulse){

    transactionLog.currentPulse = currentPulse;

    var transactionLog = mkSignleLine(JSON.stringify(transactionLog));
    console.log(transactionLog, "\n", JSON.stringify(internalValues, null, 1), "\n", currentPulse);

    fs.appendFileSync(folder + 'transactionsLog', transactionLog, 'utf8');
    fs.writeFileSync(folder + 'currentVersion', )
    }
}

exports.newPDS = function(folder){
    var pds = new FolderPersistentPDS(folder);
    return pds.memCache;
}
