import env from "~/env";

/**
 * True if the current installation is the cloud hosted version at getoutline.com
 */
const isCloudHosted =
  env.IS_CLOUD_HOSTED ??
  [
    "https://app.getoutline.com",
    "https://app.outline.dev",
    "https://app.outline.dev:3000",
  ].includes(env.URL);

export default isCloudHosted;
