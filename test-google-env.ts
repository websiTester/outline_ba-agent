import environment from "./server/utils/environment";
import env from "./plugins/google/server/env";

console.log("Raw environment.GOOGLE_CLIENT_ID:", environment.GOOGLE_CLIENT_ID);
console.log("Parsed env.GOOGLE_CLIENT_ID:", env.GOOGLE_CLIENT_ID);
console.log("Parsed env.GOOGLE_CLIENT_SECRET:", env.GOOGLE_CLIENT_SECRET);
console.log("Enabled?", !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET);
