/* oxlint-disable no-console */
/* oxlint-disable @typescript-oxlint/no-var-requires */
/* oxlint-disable no-undef */
const { exec } = require("child_process");
const { readdirSync, existsSync } = require("fs");
const fse = require("fs-extra");

const getDirectories = (source) =>
  readdirSync(source, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

/**
 * Executes a shell command and return it as a Promise.
 * @param cmd {string}
 * @return {Promise<string>}
 */
function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout ? stdout : stderr);
      }
    });
  });
}

async function build() {
  // Clean previous build
  console.log("Clean previous build…");

  await Promise.all([
    fse.remove("./build/server"),
    fse.remove("./build/plugins"),
  ]);

  const d = getDirectories("./plugins");

  // Compile server and shared
  console.log("Compiling…");
  await Promise.all([
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/server ./server"
    ),
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/shared ./shared"
    ),
  ]);

  for (const plugin of d) {
    const hasServer = existsSync(`./plugins/${plugin}/server`);

    if (hasServer) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/server" "./plugins/${plugin}/server"`
      );
    }

    const hasShared = existsSync(`./plugins/${plugin}/shared`);

    if (hasShared) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/shared" "./plugins/${plugin}/shared"`
      );
    }
  }

  // Copy static files
  console.log("Copying static files…");
  await Promise.all([
    fse.copy(
      "./server/collaboration/Procfile",
      "./build/server/collaboration/Procfile"
    ),
    fse.copy(
      "./server/static/error.dev.html",
      "./build/server/error.dev.html"
    ),
    fse.copy(
      "./server/static/error.prod.html",
      "./build/server/error.prod.html"
    ),
    fse.copy("./package.json", "./build/package.json"),
    ...d.map(async (plugin) => {
      const src = `./plugins/${plugin}/plugin.json`;
      const dest = `./build/plugins/${plugin}/plugin.json`;
      if (existsSync(src)) {
        await fse.ensureDir(`./build/plugins/${plugin}`);
        await fse.copy(src, dest);
      }
    }),
  ]);

  console.log("Done!");
}

void build();
