import env from "./plugins/google/server/env";
import config from "./plugins/google/plugin.json";

console.log("env.URL:", env.URL);
console.log("config.id:", config.id);
console.log("callbackURL:", `${env.URL}/auth/${config.id}.callback`);
