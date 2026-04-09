const glob = require("glob");
const path = require("path");

const rootDir = "build";

const joinedPattern = path.join(rootDir, "plugins/*/server/!(*.test|schema).[jt]s");
const posixPattern = rootDir + "/plugins/*/server/!(*.test|schema).[jt]s";

console.log("Joined Pattern:", joinedPattern);
console.log("Joined Result length:", glob.sync(joinedPattern).length);

console.log("Posix Pattern:", posixPattern);
console.log("Posix Result length:", glob.sync(posixPattern).length);
