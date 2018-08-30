var memoryPDS = require("./InMemoryPDS");


function FolderPersistentPDS(folder){
    this.memCache = memoryPDS.newPDS(this);

    this.persist = (transactionLog, internalValues, currentPulse){

    }
}

exports.newPDS = function(folder){
    var pds = new FolderPersistentPDS(folder);
    return pds.memCache;
}
