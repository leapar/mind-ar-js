import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { isMobile, landmarkToScreen } from "./Utils.js";
import {
  FaceLandmark,
  getBrowCenterIndex,
  getYearUpperIndex,
  getForeheadCenterTopIndex,
  getForeheadTopBelowIndex,
  getChengjiangIndex,
  getNoseLeftWingOuterIndex,
  getRightEyeSocketUpperIndex,
  getLeftEyeSocketUpperIndex,
} from "./FaceLandmarkConstants.js";
import { ARToolkit } from "./ARToolkit.js";
import { RESOURCE_PATH } from "./Utils.js";

/**
 * 样式类型枚举
 */
export const StyleType = Object.freeze({
  Ring: 1,
  Necklace: 2,
  Earring: 3,
  Bracelet: 4,
  Carving: 5,
  Watch: 7,
  Other: 8,
  Glasses: 9,
  Hat: 10,
  Mask: 11,
  Shoe: 12,
});

/**
 * 试戴模式枚举
 */
export const TryOnMode = Object.freeze({
  TDShow: 0,
  TryOn: 1,
});

/**
 * AR 试戴引擎
 * 通用的 AR 试戴库，接受任何实现了标准 AR 接口的提供者
 *
 * AR 提供者接口（ARToolkit 已实现）：
 * - init()                  初始化
 * - start()                 启动摄像头
 * - stop()                  停止摄像头
 * - render(delta)           渲染背景
 * - process(delta)          处理人脸检测
 * - tryon()                 执行试戴逻辑
 * - getPosition()           获取头部位置向量
 * - getEuler()              获取头部欧拉角
 * - calcScale()             计算模型缩放
 * - updateHeadOccluder()    更新头部遮挡
 * - onWindowResize()        窗口尺寸变化处理
 */
export class TryOnEngine {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - 容器 DOM 元素
   * @param {number} [options.styleType=StyleType.Glasses] - 试戴样式类型

   */
  constructor(options) {
    this.container = options.container;
    this.curStyleType = options.styleType || StyleType.Glasses;
    this.hdrPath = RESOURCE_PATH.HDR;
    this.dracoPath = RESOURCE_PATH.DRACO_DECODER;

    this.divWidth = this.container.clientWidth;
    this.divHeight = this.container.clientHeight;
    if (isMobile()) {
      this.divWidth = this.container.offsetWidth;
      this.divHeight = this.container.offsetHeight;
    }

    this.isFlip = true;
    this.disableHeadOccluder = false;
    this.disableEarConstraint = false;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.rootNode = null;
    this.glbScene = null;

    this.curTryOnMode = TryOnMode.TDShow;
    this.bStopRender = false;

    this._mpTmpMat4 = new THREE.Matrix4();
    this._mpTmpPos = new THREE.Vector3();
    this._mpTmpQuat = new THREE.Quaternion();
    this._mpTmpScale = new THREE.Vector3();
    this._mpTmpVec3A = new THREE.Vector3();
    this._mpTmpVec3B = new THREE.Vector3();
    this._mpTmpEuler = new THREE.Euler();
    this._mpTmpEulerFromMat = new THREE.Euler();
    this._tmpHeadScenePos = new THREE.Vector3();
    this._mpTmpVec2A = new THREE.Vector2();
    this._mpTmpVec2B = new THREE.Vector2();
    this._tryonDesiredRootPos = new THREE.Vector3();

    this.frameClock = new THREE.Clock();
    this.loopAnimation = null;
    this.results = null;

    this.enableTryOnPerfLog = false;
    this._tryOnPerfTrace = null;

    this.downRotXScale = 1.35;
    this.rotPosScale = 0.6;
    this.rotXScale = 1.4;
    this.downPosScale = 1.12;

    if (this.curStyleType == StyleType.Hat || this.curStyleType == StyleType.Mask || this.curStyleType == StyleType.Shoe) {
      this.verticalOffset = -0.062;
    }

    if (this.curStyleType == StyleType.Glasses) {
      this.verticalOffset = 0.045;
    }

    this.downPosOffset = -0.045;
    this.rotPosXScale = -2;

    this.glassesZOffset = -4;
    this.glassesYOffset = -0.7;

    this.minX = 1e4;
    this.maxX = -1e4;
    this.maxY = -1e3;
    this.minY = 1e3;
    this.maxZ = -1e3;
    this.minZ = 1e3;

    if (this.curStyleType === StyleType.Hat || this.curStyleType === StyleType.Mask) {
      this.zOffset = -7;
      this.XOffsetSpeed = 40;
      this.YOffsetSpeed = 50;
      this.rotPosScale = 0;
    }

    this.hatScale = 172;
    this.maskScale = 172;
    this.shoeScale = 172;

    this.tryonConfig = {
      earConstraint: {
        hingeHalfMinRatio: 0.5,
        hingeHalfMaxRatio: 0.72,
        blendPos: 0.35,
        blendYaw: 0,
        blendZ: 0.2,
        blendSx: 0.38,
        sxMinMult: 0.72,
        sxMaxMult: 1.35,
        yawClamp: 0.78,
      },
    };
  }

  /**
   * 初始化 Three.js 场景
   */
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.rootNode = new THREE.Object3D();
    this.scene.add(this.rootNode);
  }

  /**
   * 初始化渲染器
   */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.divWidth, this.divHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.physicallyCorrectLights = true;
    // this.renderer.toneMappingExposure = 1;
    // this.renderer.outputColorSpace = "srgb";
    // this.renderer.toneMapping = 4;
    this.renderer.domElement.id = "mainCanvas";
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.top = "0px";
    this.renderer.domElement.style.left = "0px";
    // this.renderer.shadowMap.enabled = true;
    // this.renderer.shadowMap.type = 2;
    this.container.appendChild(this.renderer.domElement);
  }

  /**
   * 初始化相机
   */
  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(45, this.divWidth / this.divHeight, 3, 5000);
    this.camera.position.set(-0.0017217397946325264, 3.9034101419022096, 284.0512709586502);
    this.camera.rotation.fromArray([-6.085433038439038e-17, 0, 0]);
    this.camera.updateMatrixWorld(true);
    this.camera.updateProjectionMatrix();
  }

  /**
   * 初始化灯光
   */
  _initLight() {
    const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.scene.add(light);
  }

  /**
   * 初始化控制器
   */
  _initControl() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
  }

  /**
   * 加载 HDR 环境贴图
   */
  _loadHDRTexture() {
    // const hdrUrls = ["px.hdr", "nx.hdr", "py.hdr", "ny.hdr", "pz.hdr", "nz.hdr"];

    // const hdrCubeMap = new HDRCubeTextureLoader()
    //   .setPath(RESOURCE_PATH.HDR)
    //   .load(hdrUrls, (texture) => {
    //     const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    //     pmremGenerator.compileEquirectangularShader();
    //     texture.encoding = "srgb";

    //     // ✅ r160 正确写法：获取 .texture
    //     const envMap = pmremGenerator.fromCubemap(texture).texture;

    //     this.scene.environment = envMap;
    //     this.scene.environmentRotation = new THREE.Euler(0, -0.6283185307179586, 0);
    //     // this.scene.background = texture; // 如需背景

    //     pmremGenerator.dispose();
    //   });

    if (!this.hdrPath) return;

    new RGBELoader().setPath(this.hdrPath).load("8c2b1e8417604838a8fb80ea204bb599.hdr", (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.environment = texture;
    });
  }

  /**
   * 初始化引擎核心（入口方法）
   */
  async init() {
    this._initScene();
    this._initRenderer();
    this._initCamera();
    this._initLight();
    this._initControl();
    this._loadHDRTexture();

    window.addEventListener("resize", this.onWindowResize);

    // 将已初始化的 Three.js 对象同步给 AR 提供者

    this.arToolkit = new ARToolkit({
      container: this.container,
      camera: this.camera,
      scene: this.scene,
      rootNode: this.rootNode,
      faceModelPath: RESOURCE_PATH.MEDIAPIPE_MODEL,
      wasmPath: RESOURCE_PATH.MEDIAPIPE_WASM,
      isGlasses: this.curStyleType === StyleType.Glasses,
      isMask: this.curStyleType === StyleType.Mask,
      isHat: this.curStyleType === StyleType.Hat,
    });

    await this.arToolkit.init();

    return this;
  }

  /**
   * 模型居中处理
   * @param {THREE.Mesh} mesh - 需要居中的网格模型
   */
  centerMeshGeometry(mesh) {
    if (mesh.userData.alreadyCenter) return;

    const geometry = mesh.geometry;
    geometry.computeBoundingBox();

    const center = new THREE.Vector3();
    geometry.boundingBox.getCenter(center);

    geometry.translate(-center.x, -center.y, -center.z);
    mesh.updateMatrix();

    const restoreMatrix = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z);
    mesh.matrix.multiply(restoreMatrix);
    mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);

    mesh.userData.alreadyCenter = true;
    mesh.userData.centerOffset = center.clone();
  }

  /**
   * 加载 3D 模型
   * @param {string} url - 模型 URL
   * @returns {Promise} 加载完成 Promise
   */
  async loadModel(url) {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(this.dracoPath || "https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
    loader.setDRACOLoader(draco);

    return new Promise((resolve) => {
      loader.load(url, (gltf) => {
        this.glbScene = gltf.scene;

        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.material.needsUpdate = true;
            child.material.opacity = 0.5;
            child.material.transparent = true;
            child.isTransparent = true;
            this.centerMeshGeometry(child);
          }
        });

        this.glbScene.rotation.set(Math.PI / 2, 0, 0);
        this.rootNode.add(this.glbScene);

        this.setCamAndObj(new THREE.Vector3(0, 0, 120), { x: 0, y: 0, z: 0 }, new THREE.Vector3(-Math.PI / 2, 0, 0), 2020);

        this.getModelMaxMinY(this.glbScene);
        this.rootNode.position.z = (this.maxZ - this.minZ) / 2;

        resolve();
      });
    });
  }

  /**
   * 加载眼镜模型（兼容旧方法名）
   * @param {string} url
   * @returns {Promise}
   */
  async loadGlassesModel(url) {
    return this.loadModel(url);
  }

  /**
   * 计算模型包围盒极值
   */
  getModelMaxMinY(glbScene) {
    glbScene.updateMatrixWorld(true);

    glbScene.traverse((child) => {
      if (child.isMesh) {
        child.geometry.computeBoundingBox();
        const box = new THREE.Box3();
        box.setFromObject(child, true);

        if (this.minX > box.min.x) this.minX = box.min.x;
        if (this.maxX < box.max.x) this.maxX = box.max.x;
        if (this.minY > box.min.y) this.minY = box.min.y;
        if (this.maxY < box.max.y) this.maxY = box.max.y;
        if (this.minZ > box.min.z) this.minZ = box.min.z;
        if (this.maxZ < box.max.z) this.maxZ = box.max.z;
      }
    });

    glbScene.userData.minX = this.minX;
    glbScene.userData.maxX = this.maxX;
    glbScene.userData.minY = this.minY;
    glbScene.userData.maxY = this.maxY;
    glbScene.userData.minZ = this.minZ;
    glbScene.userData.maxZ = this.maxZ;
  }

  /**
   * 设置相机与模型位置/旋转/缩放
   */
  setCamAndObj(camPos, objPos, objRot, objScale) {
    this.rootNode.position.set(objPos.x, objPos.y, objPos.z);
    this.rootNode.rotation.set(objRot.x, objRot.y, objRot.z);
    this.rootNode.scale.set(objScale, objScale, objScale);
    this.rootNode.updateMatrixWorld(true);
  }

  /**
   * 启动摄像头
   */
  async startWebCam() {
    return this.arToolkit.start();
  }

  /**
   * 切换试戴模式
   * @param {boolean} enable - true 开启 AR 试戴，false 切换为 3D 预览
   */
  async setTryOnMode(enable) {
    if (enable) {
      this.curTryOnMode = TryOnMode.TryOn;
      await this.startWebCam();
    } else {
      this.curTryOnMode = TryOnMode.TDShow;
      this.arToolkit.stop();
    }
  }

  /**
   * 屏幕 2D 坐标 → 3D 世界坐标
   */
  convertTo3DCoordinateTo(screenX, screenY, targetVector) {
    if (!targetVector) return null;

    const ndcX = (screenX / (this.divWidth || this.container.clientWidth)) * 2 - 1;
    const ndcY = (-screenY / (this.divHeight || this.container.clientHeight)) * 2 + 1;

    targetVector.set(ndcX, ndcY, 0.9);
    targetVector.unproject(this.camera);

    return targetVector;
  }

  /**
   * 获取耳根 3D 坐标
   * @returns {{left: THREE.Vector3, right: THREE.Vector3}|null}
   */
  getEarRoots3D() {
    if (!this.results || !this.results.faceLandmarks || !this.results.faceLandmarks[0]) {
      return null;
    }

    const landmarks = this.results.faceLandmarks[0];
    if (landmarks.length < 252) return null;

    const leftEarLandmark = landmarks[getRightEyeSocketUpperIndex()];
    const rightEarLandmark = landmarks[getLeftEyeSocketUpperIndex()];

    if (!this._earRootLeft) {
      this._earRootLeft = new THREE.Vector3();
      this._earRootRight = new THREE.Vector3();
    }

    const leftScreen = landmarkToScreen(leftEarLandmark.x, leftEarLandmark.y);
    const rightScreen = landmarkToScreen(rightEarLandmark.x, rightEarLandmark.y);
    this.convertTo3DCoordinateTo(leftScreen.x, leftScreen.y, this._mpTmpVec3A);
    this.convertTo3DCoordinateTo(rightScreen.x, rightScreen.y, this._mpTmpVec3B);

    this._earRootLeft.set(-this._mpTmpVec3A.x, this._mpTmpVec3A.y - 1, this._mpTmpVec3A.z);
    this._earRootRight.set(-this._mpTmpVec3B.x, this._mpTmpVec3B.y - 1, this._mpTmpVec3B.z);

    return {
      left: this._earRootLeft,
      right: this._earRootRight,
    };
  }

  /**
   * 窗口尺寸变化处理
   */
  onWindowResize = () => {
    this.divWidth = this.container.offsetWidth;
    this.divHeight = this.container.offsetHeight;

    this.arToolkit.onWindowResize();

    this.camera.aspect = this.divWidth / this.divHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.divWidth, this.divHeight);
  };

  /**
   * 根据姿态计算位置偏移（Hat/Mask 模式）
   */
  _adjustPositionFromRot(euler, depthFactor) {
    const pos = this.rootNode.position;
    const deltaY = euler.x * this.YOffsetSpeed * depthFactor;
    const deltaX = euler.y * this.XOffsetSpeed * depthFactor;
    this.rootNode.position.set(pos.x + deltaX, pos.y + deltaY, pos.z);
  }

  /**
   * 计算鼻尖参考点和方向向量
   */
  _calcNoseDirection(landmarks) {
    if (this.curStyleType === StyleType.Glasses) {
      const browIdx = getBrowCenterIndex();
      const yearIdx = getYearUpperIndex();
      const browScreen = landmarkToScreen(landmarks[browIdx].x, landmarks[browIdx].y);
      const yearScreen = landmarkToScreen(landmarks[yearIdx].x, landmarks[yearIdx].y);
      const noseRight = new THREE.Vector2(browScreen.x, browScreen.y);
      const noseLeft = new THREE.Vector2(yearScreen.x, yearScreen.y);
      return { noseRight, noseLeft, noseDirection: noseRight.clone().sub(noseLeft).normalize() };
    } else if (this.curStyleType === StyleType.Hat) {
      const refIdx = getForeheadCenterTopIndex();
      const belowIdx = getForeheadTopBelowIndex();
      const refScreen = landmarkToScreen(landmarks[refIdx].x, landmarks[refIdx].y);
      const belowScreen = landmarkToScreen(landmarks[belowIdx].x, landmarks[belowIdx].y);
      const noseRight = new THREE.Vector2(refScreen.x, refScreen.y);
      const noseLeft = new THREE.Vector2(belowScreen.x, belowScreen.y);
      return { noseRight, noseLeft, noseDirection: noseRight.clone().sub(noseLeft).normalize() };
    } else if (this.curStyleType === StyleType.Mask) {
      const cheekIdx = getChengjiangIndex();
      const wingIdx = getNoseLeftWingOuterIndex();
      const cheekScreen = landmarkToScreen(landmarks[cheekIdx].x, landmarks[cheekIdx].y);
      const wingScreen = landmarkToScreen(landmarks[wingIdx].x, landmarks[wingIdx].y);
      const noseRight = new THREE.Vector2(cheekScreen.x, cheekScreen.y);
      const noseLeft = new THREE.Vector2(wingScreen.x, wingScreen.y);
      return { noseRight, noseLeft, noseDirection: noseRight.clone().sub(noseLeft).normalize() };
    }
    return { noseRight: new THREE.Vector2(), noseLeft: new THREE.Vector2(), noseDirection: new THREE.Vector2() };
  }

  /**
   * 计算深度距离缩放系数
   */
  _calcDistanceScale(tempPosition, tmpEulerFromMat) {
    let distanceScale = Math.abs(-33 / tempPosition.z);
    distanceScale *= Math.cos(Math.abs(tmpEulerFromMat.y) * this.rotPosScale);
    if (tmpEulerFromMat.x < 0) {
      distanceScale *= Math.cos(-tmpEulerFromMat.x * this.rotXScale);
    }
    if (this.curStyleType === StyleType.Glasses && tmpEulerFromMat.x > 0) {
      distanceScale *= 1 + tmpEulerFromMat.x * this.downPosScale;
    }
    return distanceScale;
  }

  /**
   * 根据人脸高度计算面部缩放系数
   */
  _calcFaceScaleRatio(landmarks) {
    if (this.curStyleType !== StyleType.Glasses || !landmarks) return 1;

    const foreheadIdx = getForeheadCenterTopIndex();
    if (!landmarks[foreheadIdx] || !landmarks[FaceLandmark.CHIN_TIP]) return 1;

    const foreheadScreen = landmarkToScreen(landmarks[foreheadIdx].x, landmarks[foreheadIdx].y);
    const chinScreen = landmarkToScreen(landmarks[FaceLandmark.CHIN_TIP].x, landmarks[FaceLandmark.CHIN_TIP].y);
    const faceWidthX = foreheadScreen.x - chinScreen.x;
    const faceWidthY = foreheadScreen.y - chinScreen.y;
    const faceHeightRatio = Math.hypot(faceWidthX, faceWidthY) / this.divHeight;

    const refRatio = 0.45;
    const minScale = 0.55;
    const maxScale = 1.15;

    if (Number.isFinite(faceHeightRatio) && faceHeightRatio > 0 && refRatio > 0) {
      return Math.max(minScale, Math.min(maxScale, faceHeightRatio / refRatio));
    }
    return 1;
  }

  /**
   * 计算鼻尖偏移并转换为 3D 世界坐标
   */
  _calcTargetWorldPos(noseRight, noseDirection, distanceScale, faceScaleRatio, tmpEulerFromMat) {
    const noseOffsetVec = this._mpTmpVec2A.copy(noseDirection).multiplyScalar(this.verticalOffset * distanceScale * faceScaleRatio * this.divHeight);

    const finalScreenPos = this._mpTmpVec2B.copy(noseRight).sub(noseOffsetVec);

    if (this.curStyleType === StyleType.Glasses && tmpEulerFromMat.x > 0) {
      const downOffsetVec = this._mpTmpVec2A
        .copy(noseDirection)
        .multiplyScalar(this.downPosOffset * tmpEulerFromMat.x * faceScaleRatio * this.divHeight);
      finalScreenPos.sub(downOffsetVec);
    }

    return this.convertTo3DCoordinateTo(finalScreenPos.x, finalScreenPos.y, this._mpTmpVec3A);
  }

  /**
   * 应用耳朵约束：根据耳根位置自动适配眼镜宽度/旋转
   */
  _applyEarConstraint() {
    const earRoots = this.getEarRoots3D();
    const tryonBboxHalfSize = this.glbScene?.userData?.tryonBboxHalfSize;
    if (!earRoots || !tryonBboxHalfSize || tryonBboxHalfSize.x <= 1e-5) return;

    const leftEar = earRoots.left;
    const rightEar = earRoots.right;
    const centerEar = this._mpTmpVec3A.addVectors(leftEar, rightEar).multiplyScalar(0.5);
    const earDistVec = this._mpTmpVec3B.copy(rightEar).sub(leftEar);
    const earWidth = earDistVec.length();
    if (earWidth <= 1e-5) return;

    const earConstraint = this.tryonConfig?.earConstraint || window.defaultEarConstraint;
    const earDir = earDistVec.normalize();
    let yaw = Math.atan2(earDir.x, earDir.z);
    window.isFrontCamera && (yaw = -yaw);

    const halfWidth = tryonBboxHalfSize.x;
    const targetScaleX =
      earWidth / (2 * Math.max(halfWidth * earConstraint.hingeHalfMinRatio, Math.min(halfWidth, halfWidth * earConstraint.hingeHalfMaxRatio)));

    const currentScaleX = this.rootNode.scale.x;
    const currentRotY = this.rootNode.rotation.y;

    const minScale = earConstraint.sxMinMult * currentScaleX;
    const maxScale = earConstraint.sxMaxMult * currentScaleX;
    const finalScaleX = Math.max(minScale, Math.min(maxScale, targetScaleX));
    const scaleBlend = earConstraint.blendSx;
    this.rootNode.scale.x = currentScaleX * (1 - scaleBlend) + finalScaleX * scaleBlend;

    let finalRotY = Math.max(-earConstraint.yawClamp, Math.min(earConstraint.yawClamp, yaw));
    let rotDelta = finalRotY - currentRotY;
    const rotClamp = 0.08;
    rotDelta = Math.max(-rotClamp, Math.min(rotClamp, rotDelta));
    this.rootNode.rotation.y = currentRotY + rotDelta * earConstraint.blendYaw;

    const currentPos = this.rootNode.position;
    const posClamp = Math.max(0.04, 0.16 * earWidth);
    const dx = Math.max(-posClamp, Math.min(posClamp, (centerEar.x - currentPos.x) * earConstraint.blendPos));
    const dy = Math.max(-posClamp, Math.min(posClamp, (centerEar.y - currentPos.y) * earConstraint.blendPos));
    const dz = Math.max(-posClamp, Math.min(posClamp, (centerEar.z - currentPos.z) * earConstraint.blendZ));

    this.rootNode.position.x += dx;
    this.rootNode.position.y += dy;
    this.rootNode.position.z += dz;
  }

  /**
   * 应用样式特定位置偏移（Hat/Mask 模式）
   */
  _applyStylePositionOffset(tempPosition, tmpEulerFromMat) {
    if (this.curStyleType === StyleType.Hat) {
      const depthFactor = -15 / tempPosition.z;
      this._adjustPositionFromRot(tmpEulerFromMat, depthFactor);
    } else if (this.curStyleType === StyleType.Mask) {
      const depthFactor = 0.3 * (-15 / tempPosition.z);
      this._adjustPositionFromRot(tmpEulerFromMat, depthFactor);
    }
  }

  /**
   * 计算试戴包围盒中心（模型居中处理）
   */
  _calcTryonCenter() {
    if (this.curStyleType === StyleType.Glasses && this.glbScene && !this.glbScene.userData.tryonBboxCentered) {
      const originalPosition = this.rootNode.position.clone();
      const originalQuaternion = this.rootNode.quaternion.clone();
      const originalScale = this.rootNode.scale.clone();

      this.rootNode.position.set(0, 0, 0);
      this.rootNode.quaternion.identity();
      this.rootNode.scale.set(1, 1, 1);
      this.rootNode.updateMatrixWorld(true);

      const modelBoundingBox = new THREE.Box3().setFromObject(this.glbScene);
      const boundingBoxCenter = modelBoundingBox.getCenter(new THREE.Vector3());
      const boundingBoxSize = modelBoundingBox.getSize(new THREE.Vector3());

      if (Number.isFinite(boundingBoxCenter.x) && Number.isFinite(boundingBoxCenter.y) && Number.isFinite(boundingBoxCenter.z)) {
        this.glbScene.position.sub(boundingBoxCenter);

        this.glbScene.userData.tryonBboxCenter = boundingBoxCenter.clone();
        this.glbScene.userData.tryonBboxHalfSize = new THREE.Vector3(0.5 * boundingBoxSize.x, 0.5 * boundingBoxSize.y, 0.5 * boundingBoxSize.z);
        this.glbScene.userData.tryonBboxCentered = true;
      }

      this.rootNode.position.copy(originalPosition);
      this.rootNode.quaternion.copy(originalQuaternion);
      this.rootNode.scale.copy(originalScale);
      this.rootNode.updateMatrixWorld(true);
    }
  }

  /**
   * AR 试戴核心计算：位置/旋转/缩放/遮挡/适配
   */
  autoTryon() {
    if (!this.results?.faceLandmarks?.length || !this.rootNode) return;

    this.arToolkit.tryon();
    this._calcTryonCenter();

    const tempPosition = this.arToolkit.getPosition();
    const tmpEulerFromMat = this.arToolkit.getEuler();

    const yawRotation = 1.12 * tmpEulerFromMat.y;
    let pitchRotation = tmpEulerFromMat.x;
    if (this.curStyleType === StyleType.Glasses && tmpEulerFromMat.x > 0) {
      pitchRotation *= this.downRotXScale;
    }
    this.rootNode.rotation.set(pitchRotation, -yawRotation, -tmpEulerFromMat.z);
    this.rootNode.rotateX(-Math.PI / 2);

    const landmarks = this.results.faceLandmarks[0];
    const { noseRight, noseDirection } = this._calcNoseDirection(landmarks);

    const distanceScale = this._calcDistanceScale(tempPosition, tmpEulerFromMat);
    const faceScaleRatio = this._calcFaceScaleRatio(landmarks);
    const targetWorldPos = this._calcTargetWorldPos(noseRight, noseDirection, distanceScale, faceScaleRatio, tmpEulerFromMat);

    const desiredRootPos = this._tryonDesiredRootPos.set(-targetWorldPos.x, targetWorldPos.y - 1, targetWorldPos.z);
    if (this.curStyleType === StyleType.Glasses && this.rotPosXScale) {
      desiredRootPos.x += tmpEulerFromMat.y * this.rotPosXScale;
    }

    if (this.curStyleType === StyleType.Glasses) {
      this.rootNode.position.copy(desiredRootPos);
    } else if (this.curStyleType === StyleType.Hat || this.curStyleType === StyleType.Mask) {
      this.rootNode.position.set(desiredRootPos.x, desiredRootPos.y, desiredRootPos.z + this.zOffset);
    }

    this.rootNode.scale.copy(this.arToolkit.calcScale());

    if (!this.disableHeadOccluder) {
      this.arToolkit.updateHeadOccluder();
    }

    if (this.curStyleType === StyleType.Glasses && this.glbScene?.userData?.tryonBboxCentered && this.glbScene.userData.tryonBboxCenter) {
      const modelCenterOffset = this._mpTmpVec3B.copy(this.glbScene.userData.tryonBboxCenter);
      modelCenterOffset.multiply(this.rootNode.scale);
      modelCenterOffset.applyQuaternion(this.rootNode.quaternion);
      this.rootNode.position.copy(desiredRootPos).add(modelCenterOffset);
    }

    if (this.curStyleType === StyleType.Glasses && !this.disableEarConstraint) {
      this._applyEarConstraint();
      Number.isFinite(this.glassesZOffset) && (this.rootNode.position.z += this.glassesZOffset);
      Number.isFinite(this.glassesYOffset) && (this.rootNode.position.y += this.glassesYOffset);
    }

    this.rootNode.visible = true;
    this._applyStylePositionOffset(tempPosition, tmpEulerFromMat);

    if (this.rootNode.rotation.y > 0.8 || this.rootNode.rotation.y < -0.8) {
      this.rootNode.visible = false;
    }
  }

  /**
   * 动画循环
   */
  animate() {
    const delta = this.frameClock.getDelta();

    if (this.curTryOnMode === TryOnMode.TryOn) {
      this.arToolkit.render(delta);
    }

    if (!this.bStopRender) {
      if (this.curTryOnMode !== TryOnMode.TryOn) {
        this.controls?.update(delta);
      }
      this.loopAnimation = requestAnimationFrame(() => this.animate());

      const results = this.arToolkit.process(delta);
      if (results) {
        this.results = results;
        if (this.curTryOnMode === TryOnMode.TryOn) {
          this.autoTryon();
        }
      }

      this.renderer.render(this.scene, this.camera);
    }
  }
}
