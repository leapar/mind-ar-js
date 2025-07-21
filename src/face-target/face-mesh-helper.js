import * as vision from "@mediapipe/tasks-vision";
//import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

class FaceMeshHelper {
  constructor() {}

  async init(path) {
    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
      path || "https://f.3dman.cn/meta/facedetector"
      //"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    this.faceLandmarker = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: `${path || "https://f.3dman.cn/meta/facedetector"}/face_landmarker.task`,
        delegate: "GPU",
      },
      outputFaceBlendshapes: true,
      // outputFacialTransformationMatrixes: true,
      runningMode: "IMAGE",
      numFaces: 1,
    });
  }

  async detect(input) {
    const faceLandmarkerResult = this.faceLandmarker.detect(input);
    return faceLandmarkerResult;
  }
}

export { FaceMeshHelper };
