import { FilesetResolver, FaceLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";
import { ArToolkitBackGround } from "./ArToolkitBackGround.js";
import { ArToolkitSource } from "./ArToolkitSource.js";
import { Vector2, Vector3, Object3D, Matrix4, Quaternion, Euler } from "three";
import { ArMesh } from "./ArMesh.js";
import { convertTo3DCoordinateTo, setGlobalData, DivWidth, DivHeight, mapRange } from "./Utils.js";
import {
  FaceLandmark,
  getBrowCenterIndex,
  getNoseTipIndex,
  getPhiltrumIndex,
  getRightIrisCenterIndex,
  getLeftIrisCenterIndex,
  getRightIrisLeftIndex,
  getRightIrisRightIndex,
  getLeftIrisLeftIndex,
  getLeftIrisRightIndex,
  getForeheadCenterTopIndex,
  getChinTipIndex,
} from "./FaceLandmarkConstants.js";

const _mpTmpVec3A = new Vector3(); // 临时向量A
const _tmpHeadScenePos = new Vector3();
const _mpTmpMat4 = new Matrix4();
const _mpTmpVec3B = new Vector3();

const _mpTmpPos = new Vector3(); // 临时位置向量
const _mpTmpQuat = new Quaternion(); // 临时旋转四元数
const _mpTmpScale = new Vector3(); // 临时缩放向量
const _mpTmpEuler = new Euler(); // 临时欧拉角

const _mpTmpEulerFromMat = new Euler(); // 临时欧拉角（从矩阵转换）

/**
 * 计算MediaPipe 3D关键点之间的欧几里得距离
 */
function _calc3DDistance(pointA, pointB) {
  const dx = pointA.x - pointB.x;
  const dy = pointA.y - pointB.y;
  const dz = (pointA.z || 0) - (pointB.z || 0);
  return Math.hypot(dx, dy, dz);
}

export class ARToolkit {
  constructor(options) {
    this.container = options.container;

    this.scene = options.scene || null;
    this.camera = options.camera || null;
    this.rootNode = options.rootNode || null;
    this.isGlasses = options.isGlasses;
    this.isHat = options.isHat || false;
    this.isMask = options.isMask || false;
    this.isShoe = options.isShoe || false;

    this.wasmPath = options.wasmPath;
    this.faceModelPath = options.faceModelPath;
    this.showPoint = false;

    this.takeRender = null;
    this.arDetectCanvas = null;
    this.timeStamp = 0;
    this.singleFrameTime = 1 / 60;

    this.aiWaitFrameCnt = 0;
    this.aiMaxWaitFrameCnt = 0;

    this.arDetectMaxSize = 600;
    this.arDetectDynamicMaxSize = 600;
    this._arDetectCtx = null;
    this._arDetectFrameSeq = 0;

    this._glassesRotPrevRaw = null;
    this._glassesRotSmoothed = null;
    this.leftAngle = -0.45;
    this.leftRotArg = 0.1;

    this.outRotYMax = 1.2;
    this.outPosZMax = 2.0;

    this.aiPD = -1;
    this.fPupilDistance = 0;

    this.glassScale = 119;
    this.hatScale = 172;
    this.maskScale = 172;
    this.shoeScale = 172;
    this.glassesZOffset = -4;
    this.glassesYOffset = -0.7;

    this.faceLandmarker = null;
    this.results = null;
    this.isInitMP = false;

    this.lastVideoTime = 0;
    this.webcamVideoDom = null;

    this._syncDetectInFlight = false;
    this._initialized = false;

    // 如果 scene/camera/rootNode 已提供则立即初始化
    if (this.scene && this.camera && this.rootNode) {
      this._initInternal(options);
    }
  }

  /**
   * 内部初始化逻辑
   */
  _initInternal(options) {
    if (this._initialized) return;

    setGlobalData(this.camera, this.container.offsetWidth || 640, this.container.offsetHeight || 480);

    if (!this.headNode) {
      this.headNode = new Object3D();
      this.headNode.name = "headNode";
      this.scene.add(this.headNode);
    }

    this.background = new ArToolkitBackGround(options);
    this.background.init();

    this._initFaceLandmarker();

    this._createCaptureRender();

    this.arMesh = new ArMesh(this.scene, this.rootNode, this.headNode);

    if (this.isGlasses) {
      this.arMesh.initGlassOCMesh();
    }

    if (this.isMask) {
      this.arMesh.initMaskOCMesh();
    }

    if (this.isHat) {
      this.arMesh.initHatOCMesh();
    }

    this._initialized = true;
  }

  /**
   * 初始化入口（支持延迟初始化）
   */
  async init() {
    if (!this._initialized) {
      this._initInternal({ container: this.container });
    }
  }

  _createCaptureRender() {
    if (this.takeRender == null) {
      this.takeRender = document.createElement("canvas");
      this.container.appendChild(this.takeRender);
      this.takeRender.style.position = "absolute";
      this.takeRender.style.zIndex = "1";
      this.takeRender.style.top = "0";
      this.takeRender.style.left = "0";
      this.takeRender.id = "takeRender";
      this.canvasCtx = this.takeRender.getContext("2d");
    }

    this.takeRender.width = DivWidth;
    this.takeRender.height = DivHeight;
    this.takeRender.style.display = "block";
    this.takeRender.style.transform = this.background.bgRenderer.domElement.style.transform;

    // ==============================================
    // 5. 初始化遮挡、切换试戴模式、创建捕获渲染
    // ==============================================
    let ctx = this.takeRender.getContext("2d");
    this.drawingUtils = new DrawingUtils(ctx);
  }

  start() {
    // 初始化摄像头工具类
    this.arToolkitSource = new ArToolkitSource({
      sourceType: "webcam",
    });

    // 初始化 AR 视频源，并返回 Promise 结果
    return new Promise((resolve, reject) => {
      this.arToolkitSource.init(
        (videoDom) => {
          resolve(videoDom);
          this.webcamVideoDom = videoDom;
          this.background.setTryonBackground(videoDom);
        },

        // 初始化失败
        (error) => {
          const errorMessage = `Webcam Error\nName: ${error.name}\nMessage: ${error.message}`;
          reject(errorMessage);
        },
      );
    });
  }

  stop() {
    if (this.arToolkitSource) {
      this.arToolkitSource.uninit();
      this.arToolkitSource = null;
    }
  }

  render(delta) {
    this.background.render();
  }

  _getEffectivePupilDistance() {
    return Number.isFinite(this.fPupilDistance) && this.fPupilDistance > 0 ? this.fPupilDistance : 64;
  }

  process(delta) {
    this.timeStamp += delta;
    if (this.timeStamp <= this.singleFrameTime) {
      return;
    }

    this.aiWaitFrameCnt = this.aiWaitFrameCnt || 0;
    const maxWaitFrameCnt = Number.isFinite(this.aiMaxWaitFrameCnt) ? this.aiMaxWaitFrameCnt : 0;

    let results = null;
    if (this.aiWaitFrameCnt >= maxWaitFrameCnt) {
      this.aiWaitFrameCnt = 0;
      results = this._predictWebcam();
    } else {
      this.aiWaitFrameCnt += 1;
    }

    this.timeStamp = this.timeStamp % this.singleFrameTime;

    if (!results || !this.results || !this.results.facialTransformationMatrixes.length) {
      return results;
    }

    // 获取媒体Pipe人脸变换矩阵数据（16位 4x4 矩阵）
    const facialMatrixData = this.results.facialTransformationMatrixes[0].data;

    // 将数组数据填充到 THREE.Matrix4 矩阵中
    _mpTmpMat4.set(
      facialMatrixData[0],
      facialMatrixData[1],
      facialMatrixData[2],
      facialMatrixData[3],
      facialMatrixData[4],
      facialMatrixData[5],
      facialMatrixData[6],
      facialMatrixData[7],
      facialMatrixData[8],
      facialMatrixData[9],
      facialMatrixData[10],
      facialMatrixData[11],
      facialMatrixData[12],
      facialMatrixData[13],
      facialMatrixData[14],
      facialMatrixData[15],
    );

    // 矩阵转置后分解出 位置/旋转/缩放
    _mpTmpMat4.transpose().decompose(_mpTmpPos, _mpTmpQuat, _mpTmpScale);

    this._updateHeadNodePos();

    this._calcEuler();

    return results;
  }

  getEuler() {
    return _mpTmpEulerFromMat;
  }

  getPosition() {
    return _mpTmpPos;
  }

  _calcEuler() {
    _mpTmpEulerFromMat.setFromRotationMatrix(_mpTmpMat4);

    this._limitLeftRotation();

    if (this.isGlasses) {
      this._applyGlassesRotationSmoothing();
    } else {
      this._glassesRotSmoothed = null;
      this._glassesRotPrevRaw = null;
    }
  }

  /**
   * 左侧角度限制：防止头部过度左转，修正Z轴翻滚角度
   */
  _limitLeftRotation() {
    if (-_mpTmpEulerFromMat.y < this.leftAngle) {
      const angleDiff = this.leftAngle + _mpTmpEulerFromMat.y;
      _mpTmpEulerFromMat.z += angleDiff * this.leftRotArg;
    }
  }

  /**
   * 眼镜模式旋转平滑：低通滤波防抖
   * 快速转头时直接同步原始角度，静止/慢速时平滑插值
   */
  _applyGlassesRotationSmoothing() {
    const MOTION_EPSILON = 0.012; // 运动阈值：大于此值认为是快速转头
    const SMOOTH_ALPHA = 0.22; // 静止平滑系数：值越小越平滑

    // 计算当前旋转变化量
    let yawDiff = 0;
    let rollDiff = 0;
    if (this._glassesRotPrevRaw) {
      yawDiff = Math.abs(_mpTmpEulerFromMat.y - this._glassesRotPrevRaw.y);
      rollDiff = Math.abs(_mpTmpEulerFromMat.z - this._glassesRotPrevRaw.z);
    }

    // 更新上一帧原始旋转
    if (this._glassesRotPrevRaw) {
      this._glassesRotPrevRaw.y = _mpTmpEulerFromMat.y;
      this._glassesRotPrevRaw.z = _mpTmpEulerFromMat.z;
    } else {
      this._glassesRotPrevRaw = {
        y: _mpTmpEulerFromMat.y,
        z: _mpTmpEulerFromMat.z,
      };
    }

    const isMoving = Math.max(yawDiff, rollDiff) > MOTION_EPSILON;

    if (this._glassesRotSmoothed) {
      if (isMoving) {
        this._glassesRotSmoothed.copy(_mpTmpEulerFromMat);
      } else {
        // 低通滤波：Y/Z轴平滑跟随，X轴直接同步
        this._glassesRotSmoothed.x = _mpTmpEulerFromMat.x;
        this._glassesRotSmoothed.y += (_mpTmpEulerFromMat.y - this._glassesRotSmoothed.y) * SMOOTH_ALPHA;
        this._glassesRotSmoothed.z += (_mpTmpEulerFromMat.z - this._glassesRotSmoothed.z) * SMOOTH_ALPHA;
      }
    } else {
      this._glassesRotSmoothed = new Euler().copy(_mpTmpEulerFromMat);
    }

    _mpTmpEulerFromMat.copy(this._glassesRotSmoothed);
  }

  updateHeadOccluder() {
    // Y 轴基础旋转系数
    this.arMesh.updateHeadOccluder(this.isGlasses, this.results?.faceLandmarks?.[0], _mpTmpEulerFromMat.y);
  }

  onWindowResize() {
    setGlobalData(this.camera, this.container.offsetWidth, this.container.offsetHeight);

    this.background.onWindowResize();
    this.arToolkitSource?.onWindowResize();

    if (this.takeRender) {
      this.takeRender.style.width = DivWidth + "px";
      this.takeRender.style.height = DivHeight + "px";
      this.takeRender.width = DivWidth;
      this.takeRender.height = DivHeight;
    }
  }

  //获取faceLandmarks中的1特征点位置
  _getFaceMarkPosition(index) {
    if (!this.results || !this.results.faceLandmarks || !this.results.faceLandmarks[0]) {
      return null;
    }
    const landmark = this.results.faceLandmarks[0][index];
    if (!landmark) {
      return null;
    }

    // 使用背景层的坐标映射（自动处理 object-fit: cover 裁剪偏移）
    return this.background.landmarkToScreen(landmark.x, landmark.y);
  }

  /**
   * 绘制人脸网格连线（MediaPipe Face Mesh连接器）
   */
  _drawFaceMeshConnectors(landmarks) {
    const connectorConfigs = [
      { key: "FACE_LANDMARKS_TESSELATION", color: "#C0C0C070", lineWidth: 1 },
      { key: "FACE_LANDMARKS_RIGHT_EYE", color: "#FF3030" },
      { key: "FACE_LANDMARKS_RIGHT_EYEBROW", color: "#FF3030" },
      { key: "FACE_LANDMARKS_LEFT_EYE", color: "#30FF30" },
      { key: "FACE_LANDMARKS_LEFT_EYEBROW", color: "#30FF30" },
      { key: "FACE_LANDMARKS_FACE_OVAL", color: "#E0E0E0" },
      { key: "FACE_LANDMARKS_LIPS", color: "#E0E0E0" },
      { key: "FACE_LANDMARKS_RIGHT_IRIS", color: "#FF3030" },
      { key: "FACE_LANDMARKS_LEFT_IRIS", color: "#30FF30" },
    ];

    for (const config of connectorConfigs) {
      const connectorSet = FaceLandmarker[config.key];
      this.drawingUtils.drawConnectors(landmarks, connectorSet, config);
    }
  }

  /**
   * 绘制调试关键点（眉心-蓝色、鼻尖-红色、人中-绿色）
   */
  _drawDebugLandmarkPoints() {
    const landmarkPoints = [
      { index: getBrowCenterIndex(), color: "#0000FF", label: "眉心" }, // 眉心（山根）
      { index: getNoseTipIndex(), color: "#ff0000", label: "鼻尖" }, // 鼻尖
      { index: getPhiltrumIndex(), color: "#00FF00", label: "人中" }, // 人中
    ];

    for (const point of landmarkPoints) {
      const pos = this._getFaceMarkPosition(point.index);
      if (pos) {
        this.canvasCtx.fillStyle = point.color;
        this.canvasCtx.fillRect(pos.x - 2, pos.y - 2, 4, 4);
      }
    }
  }

  _drawingPoints() {
    if (this.results?.faceLandmarks) {
      try {
        for (const landmarks of this.results.faceLandmarks) {
          this._drawFaceMeshConnectors(landmarks);
        }
      } catch (err) {
        console.error(err);
      }
    }

    if (this.results?.faceLandmarks?.[0]) {
      this._drawDebugLandmarkPoints();
    }
  }

  /**
   * 初始化MediaPipe人脸检测器
   */
  async _initFaceLandmarker() {
    let aiCanvas = document.getElementById("aiCanvas");
    if (!aiCanvas) {
      aiCanvas = document.createElement("canvas");
      aiCanvas.id = "aiCanvas";
      aiCanvas.style.display = "none"; // 添加样式，避免显示
      this.container.appendChild(aiCanvas);
    }

    const fileset = await FilesetResolver.forVisionTasks(this.wasmPath);

    /*
        FaceDetector：192 x 192
        FaceMesh-V2：256 x 256
        Blendshape：1 x 146 x 2
    */

    this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: this.faceModelPath,
        delegate: "GPU",
      },
      canvas: aiCanvas,
      runningMode: "VIDEO",
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      numFaces: 1,
    });
    this.isInitMP = true;
  }

  _checkHeadDistance() {
    // 额头中心顶部（天中）与下巴尖，计算脸部高度
    const foreheadPoint = this.results.faceLandmarks[0][getForeheadCenterTopIndex()];
    const chinPoint = this.results.faceLandmarks[0][getChinTipIndex()];

    // 转为屏幕坐标（自动处理视频裁剪偏移）
    const foreheadScreen = this.background.landmarkToScreen(foreheadPoint.x, foreheadPoint.y);
    const chinScreen = this.background.landmarkToScreen(chinPoint.x, chinPoint.y);

    // 计算归一化后的脸部高度
    return foreheadScreen.distanceTo(chinScreen) / DivHeight;
  }

  _checkHeadAngle(rotation) {
    const threshold = 0.1;
    return (
      !(rotation.x > threshold) &&
      !(rotation.x < -threshold) &&
      !(rotation.y > threshold) &&
      !(rotation.y < -threshold) &&
      !(rotation.z > threshold) &&
      !(rotation.z < -threshold)
    );
  }

  /**
   * 测量瞳距（核心：自动计算用户瞳距，用于眼镜精准缩放）
   * 基于虹膜关键点：RIGHT_IRIS_CENTER(468)、LEFT_IRIS_CENTER(473)等
   * @returns {number} 实际瞳距（单位：mm，标准比例11.7mm）
   */
  _measurePupilDistance() {
    if (!this.results?.faceLandmarks?.[0]) {
      return -1;
    }

    const landmarks = this.results.faceLandmarks[0];
    if (landmarks.length <= 476) {
      return -1;
    }

    // 计算瞳孔内部平均距离
    // 右眼瞳孔区域：RIGHT_IRIS_LEFT(469) / RIGHT_IRIS_RIGHT(471)
    // 左眼瞳孔区域：LEFT_IRIS_LEFT(474) / LEFT_IRIS_RIGHT(476)
    const leftPupilDist = _calc3DDistance(landmarks[getRightIrisLeftIndex()], landmarks[getRightIrisRightIndex()]);
    const rightPupilDist = _calc3DDistance(landmarks[getLeftIrisLeftIndex()], landmarks[getLeftIrisRightIndex()]);
    const avgPupilInnerDist = (leftPupilDist + rightPupilDist) / 2;

    if (!Number.isFinite(avgPupilInnerDist) || avgPupilInnerDist <= 0) {
      return -1;
    }

    // 左右瞳孔中心距离（真正的瞳距）
    // RIGHT_IRIS_CENTER(468) / LEFT_IRIS_CENTER(473)
    const pupilCenterDist = _calc3DDistance(landmarks[getRightIrisCenterIndex()], landmarks[getLeftIrisCenterIndex()]);
    if (!Number.isFinite(pupilCenterDist) || pupilCenterDist <= 0) {
      return -1;
    }

    // 比例换算 → 标准瞳距 11.7mm（AR眼镜自动缩放核心公式）
    return (pupilCenterDist / avgPupilInnerDist) * 11.7;
  }

  tryon() {
    if (!this.results.facialTransformationMatrixes.length) {
      return;
    }

    if (this.showPoint) {
      this.canvasCtx.clearRect(0, 0, this.takeRender.width, this.takeRender.height);
      this._drawingPoints();
    }

    // ==========================
    // 9. 头部距离 / 角度检测
    // ==========================
    const headDistanceValid = this._checkHeadDistance();
    const headAngleValid = this._checkHeadAngle(_mpTmpEulerFromMat);

    // 自动测量瞳距（条件满足时）
    if (this.isGlasses && this.aiPD === -1 && headAngleValid && headDistanceValid > 0.3 && headDistanceValid < 0.8) {
      setTimeout(() => {
        let measuredPupilDistance = this._measurePupilDistance();
        if (measuredPupilDistance > 0) {
          this.aiPD = measuredPupilDistance;
          this.fPupilDistance = this.aiPD;
        }
      }, 800);
    }

    if (this.isGlasses) {
      this.arMesh.updateFaceMesh(this.results.faceLandmarks);
    }
  }

  _detectFaceForVideo() {
    if (!this.webcamVideoDom) {
      return null;
    }
    const now = performance.now();
    if (this.webcamVideoDom.currentTime && this.lastVideoTime !== this.webcamVideoDom.currentTime) {
      this.lastVideoTime = this.webcamVideoDom.currentTime;
      this._arDetectFrameSeq = (this._arDetectFrameSeq || 0) + 1;

      const videoW = this.webcamVideoDom.videoWidth;
      const videoH = this.webcamVideoDom.videoHeight;
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
      this._arDetectCtx.drawImage(this.webcamVideoDom, 0, 0, videoW, videoH, 0, 0, targetW, targetH);

      this.results = this.faceLandmarker.detectForVideo(this.arDetectCanvas, now);

      return this.results;
    }

    return null;
  }

  _predictWebcam() {
    if (!this.isInitMP) return;

    if (this._syncDetectInFlight) {
      console.error("_syncDetectInFlight");
      return;
    }
    this._syncDetectInFlight = true;
    try {
      return this._detectFaceForVideo();
    } finally {
      this._syncDetectInFlight = false;
    }
  }

  // 获取眉心坐标
  _getEyebrowPosition(params) {
    if (!this.results || !this.results.faceLandmarks || !this.results.faceLandmarks[0]) {
      return null;
    }
    // 眉心（山根）
    const eyebrowPoint = this._getFaceMarkPosition(getBrowCenterIndex());

    // 转为3D世界坐标
    const eyebrowWorldPos = convertTo3DCoordinateTo(eyebrowPoint.x, eyebrowPoint.y, _mpTmpVec3A);

    // 可选Y轴偏移（用于微调眼镜高度）
    const yOffset = -1; //t && t.desiredRootPosYOffset != null ? t.desiredRootPosYOffset :

    // 计算最终头部位置
    _tmpHeadScenePos.set(-eyebrowWorldPos.x, eyebrowWorldPos.y + yOffset, eyebrowWorldPos.z);

    return _tmpHeadScenePos;
  }

  calcScale() {
    // ==========================
    // 4. 旋转 → Z轴深度 映射参数（远近自动适配）
    // ==========================
    const mapRotInMin = 0;
    const mapRotInMax = 2;
    const mapRotOutMin = 1;
    const mapPosMaxZ = -15; //ce
    const mapPosInMax = 172;
    const mapPosOutMin = 1;

    // 旋转映射输出
    const mappedRotY = mapRange(Math.abs(_mpTmpEulerFromMat.y), mapRotInMin, mapRotInMax, mapRotOutMin, this.outRotYMax); //de
    const depthRange = Math.abs(_mpTmpPos.z - mapPosMaxZ); //pe
    const mappedPosZ = mapRange(Math.abs(_mpTmpPos.z), depthRange, mapPosInMax, mapPosOutMin, this.outPosZMax); //fe

    // ==========================
    // 5. 眼镜最终缩放（自动适配瞳距 + 距离 + 角度）
    // ==========================

    if (this.isGlasses) {
      // 横竖屏适配
      const layoutType = DivWidth > DivHeight ? "landscape" : "portrait";
      const layoutConfig = null;

      // 瞳距参考基准
      let pupilScaleRef = layoutConfig && layoutConfig.pupilScaleRef ? layoutConfig.pupilScaleRef : 195;

      // 实际瞳距
      const effectivePupilDist = this._getEffectivePupilDistance();

      // 最终缩放 = 基础缩放 * 基准 / 实际瞳距 * 旋转映射 * 深度映射

      _mpTmpScale.multiplyScalar((((this.glassScale * pupilScaleRef) / effectivePupilDist / mappedRotY) * (mapPosMaxZ / _mpTmpPos.z)) / mappedPosZ);
    } else if (this.isHat) {
      _mpTmpScale.multiplyScalar((3.3 * this.hatScale * (mapPosMaxZ / _mpTmpPos.z)) / mappedPosZ);
    } else if (this.isMask) {
      _mpTmpScale.multiplyScalar((3.5 * this.maskScale * (mapPosMaxZ / _mpTmpPos.z)) / mappedPosZ);
    } else if (this.isShoe) {
      const effectivePupilDist = this._getEffectivePupilDistance();
      _mpTmpScale.multiplyScalar((((200 * this.shoeScale) / effectivePupilDist / mappedRotY) * (mapPosMaxZ / _mpTmpPos.z)) / mappedPosZ);
    }

    // 头部节点同步缩放
    if (this.isGlasses && this.headNode) {
      this.headNode.scale.copy(_mpTmpScale);
    }

    return _mpTmpScale;
  }

  // 更新头部节点位置
  _updateHeadNodePos() {
    //模型坐标定位
    _mpTmpVec3A.copy(_mpTmpPos);
    if (this.isGlasses) {
      const eyebrowWorldPos = this._getEyebrowPosition();

      if (eyebrowWorldPos) {
        _mpTmpVec3A.copy(eyebrowWorldPos);
      }
    }
    this.headNode.position.copy(_mpTmpVec3A);

    // ======================
    // 旋转处理：前置相机需要水平翻转（Y轴取反）
    // ======================

    // 如果是前置摄像头，翻转水平方向
    if (window.isFrontCamera) {
      const tempEuler = _mpTmpEuler.setFromQuaternion(_mpTmpQuat);
      tempEuler.y = -tempEuler.y; // 水平翻转
      _mpTmpQuat.setFromEuler(tempEuler);
    }

    // 最终应用头部旋转
    this.headNode.quaternion.copy(_mpTmpQuat);

    this.headNode.visible = this.isGlasses;
  }
}
