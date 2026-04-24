import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";

/**
 * 人脸检测器抽象基类
 * 所有检测器实现必须继承此类并实现以下接口：
 * - async init(options): 初始化检测模型
 * - detect(videoElement, timestamp): 执行单帧检测，返回统一格式结果
 * - get isReady: 检测器是否已就绪
 * - dispose(): 释放资源
 */
export class FaceDetectorBase {
  constructor() {
    this._ready = false;
  }

  get isReady() {
    return this._ready;
  }

  /**
   * 初始化检测模型
   * @param {Object} options - 初始化参数
   * @param {string} options.wasmPath - WASM 文件路径
   * @param {string} options.faceModelPath - 模型文件路径
   * @param {HTMLCanvasElement} options.canvas - 检测用 Canvas
   */
  async init(options) {
    throw new Error("FaceDetectorBase.init 必须由子类实现");
  }

  /**
   * 执行单帧人脸检测
   * @param {HTMLVideoElement} videoElement - 视频源
   * @param {number} timestamp - 当前时间戳（performance.now）
   * @returns {Object|null} 检测结果，格式如下：
   *   {
   *     faceLandmarks: [[{x, y, z}, ...]],
   *     facialTransformationMatrixes: [{data: Float32Array(16)}],
   *     faceBlendshapes: []
   *   }
   *   未检测到人脸时返回 null
   */
  detect(videoElement, timestamp) {
    throw new Error("FaceDetectorBase.detect 必须由子类实现");
  }

  /**
   * 释放检测器资源
   */
  dispose() {
    throw new Error("FaceDetectorBase.dispose 必须由子类实现");
  }
}

/**
 * MediaPipe FaceLandmarker 检测器实现
 * 封装 MediaPipe tasks-vision 的 FaceLandmarker，输出统一格式结果
 */
export class MediaPipeFaceDetector extends FaceDetectorBase {
  constructor() {
    super();
    this.faceLandmarker = null;
    this.arDetectCanvas = null;
    this._arDetectCtx = null;
    this.arDetectMaxSize = 600;
    this.arDetectDynamicMaxSize = 600;
    this.lastVideoTime = 0;
    this._syncDetectInFlight = false;
  }

  /**
   * 初始化 MediaPipe FaceLandmarker
   * @param {Object} options
   * @param {string} options.wasmPath - WASM 路径
   * @param {string} options.faceModelPath - 模型路径
   */
  async init(options) {
    const { wasmPath, faceModelPath } = options;

    let aiCanvas = document.getElementById("aiCanvas");
    if (!aiCanvas) {
      aiCanvas = document.createElement("canvas");
      aiCanvas.id = "aiCanvas";
      aiCanvas.style.display = "none";
      document.body.appendChild(aiCanvas);
    }

    const fileset = await FilesetResolver.forVisionTasks(wasmPath);

    this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: faceModelPath,
        delegate: "GPU",
      },
      canvas: aiCanvas,
      runningMode: "VIDEO",
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      numFaces: 1,
    });

    this._ready = true;
  }

  /**
   * 对视频帧执行人脸检测
   * @param {HTMLVideoElement} videoElement
   * @param {number} timestamp
   * @returns {Object|null}
   */
  detect(videoElement, timestamp) {
    if (!videoElement || !this._ready) {
      return null;
    }

    if (!videoElement.currentTime || this.lastVideoTime === videoElement.currentTime) {
      return null;
    }

    if (this._syncDetectInFlight) {
      return null;
    }

    this._syncDetectInFlight = true;
    try {
      return this._detectFrame(videoElement, timestamp);
    } finally {
      this._syncDetectInFlight = false;
    }
  }

  /**
   * 内部：执行单帧检测
   */
  _detectFrame(videoElement, timestamp) {
    this.lastVideoTime = videoElement.currentTime;

    const videoW = videoElement.videoWidth;
    const videoH = videoElement.videoHeight;
    const maxSize = this.arDetectDynamicMaxSize || this.arDetectMaxSize;
    const scale = Math.min(1, maxSize / Math.min(videoW, videoH));
    const targetW = Math.max(1, Math.round(videoW * scale));
    const targetH = Math.max(1, Math.round(videoH * scale));

    if (!this.arDetectCanvas) {
      this.arDetectCanvas = document.createElement("canvas");
      this._arDetectCtx = this.arDetectCanvas.getContext("2d", { willReadFrequently: false });
    }

    if (this.arDetectCanvas.width !== targetW || this.arDetectCanvas.height !== targetH) {
      this.arDetectCanvas.width = targetW;
      this.arDetectCanvas.height = targetH;
    }

    this._arDetectCtx.drawImage(videoElement, 0, 0, videoW, videoH, 0, 0, targetW, targetH);

    const results = this.faceLandmarker.detectForVideo(this.arDetectCanvas, timestamp);

    // 返回统一格式
    if (!results || !results.facialTransformationMatrixes?.length) {
      return null;
    }

    return {
      faceLandmarks: results.faceLandmarks,
      facialTransformationMatrixes: results.facialTransformationMatrixes,
      faceBlendshapes: results.faceBlendshapes || [],
    };
  }

  /**
   * 释放 MediaPipe 检测器资源
   */
  dispose() {
    if (this.faceLandmarker) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
    }
    if (this.arDetectCanvas) {
      this.arDetectCanvas = null;
      this._arDetectCtx = null;
    }
    this._ready = false;
  }
}
