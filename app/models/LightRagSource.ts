import { observable } from "mobx";
import Model from "./base/Model";
import Field from "./decorators/Field";

class LightRagSource extends Model {
  static modelName = "LightRagSource";

  @observable
  @Field
  teamId?: string;

  @observable
  @Field
  userId?: string;

  @observable
  @Field
  filePath: string;

  @observable
  @Field
  fileName: string;

  @observable
  @Field
  status: "pending" | "processing" | "preprocessed" | "processed" | "failed" | "done" | "error";

  @observable
  @Field
  errorMsg: string | null;

  @observable
  @Field
  summary: string | null;

  @observable
  @Field
  length: number;

  @observable
  @Field
  chunks: number;
}

export default LightRagSource;
