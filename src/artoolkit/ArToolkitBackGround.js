import {
  ClampToEdgeWrapping,
  Color,
  MeshBasicMaterial,
  OrthographicCamera,
  LinearFilter,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
  Texture,
  VideoTexture,
  PlaneGeometry,
  Mesh,
  Vector2,
} from "three";
import { DivWidth, DivHeight, setVideoCropOffset } from "./Utils.js";

export class ArToolkitBackGround {
  constructor(options) {
    this.container = options.container;

    this.isFlip = true;
    this.bgMesh = null;
    this._bgCoverScaleSig = null;
    this.bgRenderer = null;
    this._bgVideoTexture = null;
    this.scene = null;
    this.camera = null;
    this.webCamVideo = null;

    this.isModelTryon = false; // 初始化
    this.divDelta = 13; // 初始化

    // 视频裁剪偏移（object-fit: cover 导致的视频与显示区域不匹配）
    this._videoCropOffset = { left: 0, top: 0, scaleX: 1, scaleY: 1 };
  }

  /**
   * 计算视频显示区域在容器中的裁剪偏移
   * 用于将 MediaPipe  landmark 坐标（视频帧空间）映射到显示区域（屏幕空间）
   */
  _updateVideoCrop() {
    const videoW = this.webCamVideo?.videoWidth;
    const videoH = this.webCamVideo?.videoHeight;
    if (!videoW || !videoH) {
      this._videoCropOffset = { left: 0, top: 0, scaleX: 1, scaleY: 1 };
      setVideoCropOffset(0, 0, 1, 1);
      return;
    }

    const displayW = DivWidth;
    const displayH = DivHeight;
    const videoAspect = videoW / videoH;
    const displayAspect = displayW / displayH;

    if (videoAspect > displayAspect) {
      // 视频更宽 → 左右裁剪
      const displayWInVideo = videoH * displayAspect;
      const cropLeft = (videoW - displayWInVideo) / 2;
      const normalizedLeft = cropLeft / videoW;
      const scaleX = displayWInVideo / videoW;
      this._videoCropOffset.left = normalizedLeft;
      this._videoCropOffset.top = 0;
      this._videoCropOffset.scaleX = scaleX;
      this._videoCropOffset.scaleY = 1;
      setVideoCropOffset(normalizedLeft, 0, scaleX, 1);
    } else {
      // 视频更高 → 上下裁剪
      const displayHInVideo = videoW / displayAspect;
      const cropTop = (videoH - displayHInVideo) / 2;
      const normalizedTop = cropTop / videoH;
      const scaleY = displayHInVideo / videoH;
      this._videoCropOffset.left = 0;
      this._videoCropOffset.top = normalizedTop;
      this._videoCropOffset.scaleX = 1;
      this._videoCropOffset.scaleY = scaleY;
      setVideoCropOffset(0, normalizedTop, 1, scaleY);
    }
  }

  /**
   * 将 MediaPipe landmark 归一化坐标（视频帧空间）转换为显示区域坐标（屏幕空间）
   * @param {number} landmarkX - landmark.x（0-1，相对于视频帧）
   * @param {number} landmarkY - landmark.y（0-1，相对于视频帧）
   * @returns {Vector2} 屏幕坐标
   */
  landmarkToScreen(landmarkX, landmarkY) {
    const { left, top, scaleX, scaleY } = this._videoCropOffset;
    const screenX = ((landmarkX - left) / scaleX) * DivWidth;
    const screenY = ((landmarkY - top) / scaleY) * DivHeight;
    return new Vector2(screenX, screenY);
  }

  /**
   * 初始化 AR/试戴 背景渲染系统
   * 包含：背景场景、正交相机、独立渲染器、离屏画布
   * 用于渲染视频背景/纯色背景/双层渲染画面
   */
  init() {
    // ======================
    // 1. 创建/复用 背景场景 (Scene)
    // vi = THREE.Scene
    // ======================
    if (!this.scene) {
      this.scene = new Scene();
    }
    // 设置背景颜色：默认灰色 #EFEFEF (15658734 十进制颜色)
    this.scene.background = new Color(15658734);

    // ======================
    // 2. 创建/复用 正交背景相机 (OrthographicCamera)
    // Do = THREE.OrthographicCamera
    // ======================
    if (!this.camera) {
      // 正交相机参数：left, right, top, bottom, near, far
      this.camera = new OrthographicCamera(
        DivWidth / -2, // 左
        DivWidth / 2, // 右
        DivHeight / 2, // 上
        DivHeight / -2, // 下
        0.3, // 近裁剪面
        2000, // 远裁剪面
      );
    }

    // ======================
    // 3. 创建/复用 独立背景渲染器 (WebGLRenderer)
    // du = THREE.WebGLRenderer
    // ======================
    if (!this.bgRenderer) {
      this.bgRenderer = new WebGLRenderer({
        antialias: false, // 开启抗锯齿
        alpha: false, // 关闭透明（背景不透明）
        preserveDrawingBuffer: false, // 保留绘图缓冲区（用于截图/保存）
      });

      // DOM 样式设置（置于最底层）
      this.bgRenderer.domElement.style.position = "absolute";
      this.bgRenderer.domElement.style.zIndex = "-2";
      this.bgRenderer.domElement.style.top = "0";
      this.bgRenderer.domElement.style.left = "0";
      this.bgRenderer.domElement.id = "bgRendererCanvas";

      // 关闭阴影（背景不需要阴影）
      this.bgRenderer.shadowMap.enabled = false;

      // 设置渲染尺寸
      this.bgRenderer.setSize(DivWidth, DivHeight);

      // 添加到 zoomMask 容器显示
      this.container.appendChild(this.bgRenderer.domElement);

      if (this.isFlip) {
        this.bgRenderer.domElement.style.transform = "rotateY(180deg)";
        this.bgRenderer.domElement.style.webkitTransform = "rotateY(180deg)";
        this.bgRenderer.domElement.style.mozTransform = "rotateY(180deg)";
        this.bgRenderer.domElement.style.msTransform = "rotateY(180deg)";
      }
    }
  }

  /**
   * 设置试戴背景视频网格的缩放
   * 让视频铺满整个屏幕，并保持原始比例（Crop 模式）
   * @param {number} screenWidth  屏幕宽度
   * @param {number} screenHeight 屏幕高度
   * @private
   */
  _setTryMeshScale(screenWidth, screenHeight) {
    // 没有背景网格直接返回
    if (!this.bgMesh) {
      return;
    }

    // 获取摄像头视频真实宽高
    const videoWidth = this.webCamVideo?.videoWidth;
    const videoHeight = this.webCamVideo?.videoHeight;

    // 视频未加载完成时不处理
    if (!videoWidth || !videoHeight || videoWidth <= 0 || videoHeight <= 0) {
      return;
    }

    // ==============================================
    // 计算缩放比例：让视频铺满屏幕（等比缩放，裁剪模式）
    // ==============================================
    const scale = Math.max(screenWidth / videoWidth, screenHeight / videoHeight);

    // 计算最终铺满屏幕的视频尺寸
    const finalWidth = videoWidth * scale;
    const finalHeight = videoHeight * scale;

    // 根据是否翻转，决定 X 轴方向
    const scaleX = this.isFlip ? finalWidth : -finalWidth;
    const scaleY = finalHeight;

    // ==============================================
    // 只有参数变化时才更新（避免重复设置，提升性能）
    // ==============================================
    const scaleSignature = `${screenWidth}|${screenHeight}|${videoWidth}|${videoHeight}|${scaleX}|${scaleY}`;

    if (this._bgCoverScaleSig !== scaleSignature) {
      this._bgCoverScaleSig = scaleSignature;

      // 应用缩放
      this.bgMesh.scale.set(scaleX, scaleY, 1);
    }
  }

  /**
   * 设置 AR 试戴背景：摄像头视频流作为 3D 背景
   * 创建视频纹理 + 背景平面 + 自动适配缩放
   */
  setTryonBackground(webCamVideo) {
    this.webCamVideo = webCamVideo;
    if (!this.webCamVideo) {
      return;
    }

    // 显示背景渲染器画布
    if (this.bgRenderer && this.bgRenderer.domElement) {
      this.bgRenderer.domElement.style.display = "block";
    }

    // 隐藏原生 video 元素（只用作纹理源，不直接显示）
    if (this.webCamVideo.style) {
      this.webCamVideo.style.opacity = "0";
    }

    // ==============================================
    // 2. 创建/复用 视频纹理（摄像头画面 → Three.js 纹理）
    // ya = VideoTexture
    // ==============================================
    if (!this._bgVideoTexture || this._bgVideoTexture.image !== this.webCamVideo) {
      // 销毁旧纹理（防止内存泄漏）
      if (this._bgVideoTexture) {
        this._bgVideoTexture.dispose();
      }

      // 创建视频纹理
      this._bgVideoTexture = new VideoTexture(this.webCamVideo);
      const videoTex = this._bgVideoTexture;

      // 纹理参数（不重复、线性过滤、关闭Mipmap）
      videoTex.wrapS = ClampToEdgeWrapping;
      videoTex.wrapT = ClampToEdgeWrapping;
      videoTex.minFilter = LinearFilter;
      videoTex.magFilter = LinearFilter;
      videoTex.generateMipmaps = false;
      videoTex.colorSpace = SRGBColorSpace;
    }

    const videoTexture = this._bgVideoTexture;

    // ==============================================
    // 3. 创建/更新 背景平面（显示视频的网格）
    // xr = MeshBasicMaterial
    // Da = PlaneGeometry
    // Kr = Mesh
    // ==============================================
    const bgPlane = this.scene.getObjectByName("bgPlane");
    if (bgPlane) {
      // 已存在：直接更新纹理
      this.bgMesh.visible = true;

      // 替换纹理并销毁旧纹理
      if (this.bgMesh.material.map && this.bgMesh.material.map !== videoTexture) {
        this.bgMesh.material.map.dispose?.();
      }

      this.bgMesh.material.map = videoTexture;
      this.bgMesh.material.needsUpdate = true;
    } else {
      // 不存在：创建新的背景网格
      const bgMaterial = new MeshBasicMaterial({
        map: videoTexture,
      });

      const bgGeometry = new PlaneGeometry(1, 1);
      this.bgMesh = new Mesh(bgGeometry, bgMaterial);

      // 放在相机前方 -172 单位（不遮挡3D内容）
      this.bgMesh.position.set(0, 0, -172);
      this.bgMesh.name = "bgPlane";

      this.scene.add(this.bgMesh);
    }

    // ==============================================
    // 4. 更新正交相机（适配屏幕宽高）
    // ==============================================
    this.camera.left = DivWidth / -2;
    this.camera.right = DivWidth / 2;
    this.camera.top = DivHeight / 2;
    this.camera.bottom = DivHeight / -2;
    this.camera.updateProjectionMatrix();

    // ==============================================
    // 6. 视频加载完成后 → 自动适配画面比例
    // ==============================================
    const onVideoReady = () => {
      if (this.bgMesh && this.webCamVideo && this.webCamVideo.videoWidth > 0 && this.webCamVideo.videoHeight > 0) {
        this._setTryMeshScale(DivWidth, DivHeight);
        // 视频尺寸可用后，重新计算裁剪偏移
        this._updateVideoCrop();
      }
    };

    // 监听视频加载事件
    this.webCamVideo.addEventListener("loadedmetadata", onVideoReady, { once: true });
    this.webCamVideo.addEventListener("loadeddata", onVideoReady, { once: true });
    this.webCamVideo.addEventListener("playing", onVideoReady, { once: true });

    // 延迟触发（兼容加载慢的设备）
    [0, 120, 320, 700].forEach((delay) => {
      setTimeout(onVideoReady, delay);
    });

    // ==============================================
    // 7. 启动 AI 人脸检测
    // ==============================================

    // 执行一次缩放适配
    onVideoReady();

    // 计算视频裁剪偏移
    this._updateVideoCrop();
  }

  render() {
    // 如果背景渲染器存在且处于显示状态，则执行背景画面渲染
    if (this.bgRenderer && this.bgRenderer.domElement && this.bgRenderer.domElement.style.display !== "none") {
      // 当视频已加载完成时，设置背景网格的适配缩放（保持视频比例）
    if (this.bgMesh && this.webCamVideo && this.webCamVideo.videoWidth > 0) {
      this._setTryMeshScale(DivWidth, DivHeight);
    }

      // 渲染背景场景（摄像头画面/纯色背景）
      this.bgRenderer.render(this.scene, this.camera);
    }
  }

  onWindowResize() {
    // 更新视频裁剪偏移（容器尺寸变化）
    this._updateVideoCrop();

    this.bgRenderer.setSize(DivWidth, DivHeight);

    let renderHeight = DivHeight;
    let renderWidth = DivWidth;

    // 背景网格处理
    if (this.bgMesh !== null && this.bgMesh !== undefined) {
      if (this.isModelTryon) {
        this.camera.left = DivWidth / -2;
        this.camera.right = DivWidth / 2;
        this.camera.top = DivHeight / 2;
        this.camera.bottom = DivHeight / -2;

        renderHeight = DivHeight;
        renderWidth = (DivHeight * this.bgMesh.material.map.image.width) / this.bgMesh.material.map.image.height;
        this.bgMesh.scale.set(renderWidth, renderHeight, 1);
      } else {
        this.camera.left = renderWidth / -2;
        this.camera.right = renderWidth / 2;
        this.camera.top = renderHeight / 2;
        this.camera.bottom = renderHeight / -2;

        let tryW = DivWidth;
        let tryH = DivHeight;

        if (DivWidth > DivHeight && DivWidth - DivHeight > this.divDelta) {
          tryW = (4 * DivHeight) / 3;
        }
        this._setTryMeshScale(tryW, tryH);
      }
      this.camera.updateProjectionMatrix();
    }
  }
}