import { isMobile, isDesktopOS, DivWidth, DivHeight } from "./Utils.js";

class ArToolkitSource {
  constructor(options) {
    // 状态
    this.ready = false;
    this.videoElement = null;

    this.container = options.container || document.body;

    // 默认参数
    this.parameters = {
      sourceType: "webcam",
      sourceWidth: 1920,
      sourceHeight: 1080,
      displayWidth: 640,
      displayHeight: 480,
    };

    // 合并用户配置
    this.parameters = Object.assign(this.parameters, options);

    if (!isDesktopOS() && DivHeight < DivWidth) {
      this.parameters.sourceWidth = Math.max(DivWidth, 1920);
      this.parameters.sourceHeight = Math.max(DivHeight, 1080);
      this.parameters.displayWidth = DivWidth;
      this.parameters.displayHeight = DivHeight;
    } else {
      this.parameters.sourceWidth = Math.max(DivWidth, 1080);
      this.parameters.sourceHeight = Math.max(DivHeight, 1920);
      this.parameters.displayWidth = DivWidth;
      this.parameters.displayHeight = DivHeight;
    }
  }

  /**
   * 反初始化摄像头源
   */
  uninit() {
    if (!this.videoElement) {
      return;
    }
    this.videoElement.style.display = "none";
    const stream = this.videoElement.srcObject;
    if (stream != null) {
      // 停止当前摄像头流
      stream.getVideoTracks()[0].stop();
    }
    // 移除旧的视频 DOM
    this.videoElement.remove();

    this.videoElement = null;
  }

  /**
   * 初始化摄像头源
   * @param {Function} onSuccess 成功回调
   * @param {Function} onError 错误回调
   */
  init(onSuccess, onError) {
    this.uninit();

    if (this.parameters.sourceType === "webcam") {
      this._initVideoDom();
      this._initSourceWebcam(() => {
        // 触发视频加载完成事件
        window.dispatchEvent(
          new CustomEvent("arjs-video-loaded", {
            detail: {
              component: document.querySelector("#arjs-video"),
            },
          }),
        );

        this.ready = true;
        onSuccess && onSuccess(this.videoElement);
      }, onError);
    }
  }

  _initVideoDom() {
    // 获取或创建 video 元素
    this.videoElement = document.getElementById("arjs-video");
    if (!this.videoElement) {
      this.videoElement = document.createElement("video");
      this.videoElement.setAttribute("autoplay", "");
      this.videoElement.setAttribute("loop", "");
      this.videoElement.setAttribute("muted", "");
      this.videoElement.setAttribute("playsinline", "");
      this.videoElement.style.width = this.parameters.displayWidth + "px";
      this.videoElement.style.height = this.parameters.displayHeight + "px";
      this.videoElement.id = "arjs-video";

      // 统一设置视频样式
      this.videoElement.style.zIndex = "-5";
    }
  }

  // 优化视频宽高检测
  _getUserMediaSuccess(stream, onReady, onError) {
    this.videoElement.srcObject = stream;

    // 触发摄像头初始化事件
    const event = new CustomEvent("camera-init", { stream });
    window.dispatchEvent(event);

    this.container.appendChild(this.videoElement);

    // 移动端必须点击才能播放
    const playVideo = () => {
      this.videoElement?.play();
      // 移除事件监听器
      document.body.removeEventListener("click", playVideo);
    };
    document.body.addEventListener("click", playVideo);
    this.videoElement.play();

    // 等待视频宽高可用后回调
    let checkCount = 0;
    const checkInterval = setInterval(() => {
      if (this.videoElement.videoWidth > 0) {
        onReady();
        clearInterval(checkInterval);
      } else if (checkCount > 50) {
        // 最多检查50次
        clearInterval(checkInterval);
        onError(new Error("Video dimensions not available"));
      }
      checkCount++;
    }, 20);
  }

  /**
   * 内部方法：初始化 WebCam 摄像头
   * @param {Function} onReady 准备好回调
   * @param {Function} onError 错误回调
   * @returns {HTMLVideoElement} video 元素
   */
  _initSourceWebcam(onReady, onError) {
    // 默认错误提示
    onError =
      onError ||
      function (err) {
        alert("Webcam Error\nName: " + err.name + "\nMessage: " + err.message);
        const event = new CustomEvent("camera-error", { error: err });
        window.dispatchEvent(event);
      };

    // 兼容旧浏览器：补全 mediaDevices
    if (typeof navigator.mediaDevices === "undefined") {
      navigator.mediaDevices = {};
    }

    // 兼容旧浏览器：补全 getUserMedia
    if (typeof navigator.mediaDevices.getUserMedia === "undefined") {
      navigator.mediaDevices.getUserMedia = function (constraints) {
        const getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
        if (!getUserMedia) {
          return Promise.reject(new Error("getUserMedia is not implemented in this browser"));
        }

        return new Promise((resolve, reject) => {
          getUserMedia.call(navigator, constraints, resolve, reject);
        });
      };
    }

    // 枚举设备并配置摄像头参数
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        // 收集所有摄像头 ID
        const videoDeviceIds = [];
        devices.forEach((device) => {
          if (device.kind.toLowerCase() === "videoinput") {
            videoDeviceIds.push(device.deviceId);
          }
        });

        // 计算摄像头分辨率（移动端适配）
        let innerWidth = window.innerWidth;
        let innerHeight = window.innerHeight;
        let captureWidth = innerWidth;
        let captureHeight = innerHeight;

        // 移动端竖屏处理
        if (isMobile() && innerHeight > innerWidth) {
          captureWidth = innerHeight;
          captureHeight = innerWidth;
        }

        // 移动端限制最大分辨率
        if (isMobile()) {
          const maxSize = Math.max(captureWidth, captureHeight);
          if (maxSize > 960) {
            const scale = 960 / maxSize;
            captureWidth = Math.max(320, Math.round(captureWidth * scale));
            captureHeight = Math.max(320, Math.round(captureHeight * scale));
          }
        }

        // 最终摄像头约束
        const mediaConstraints = {
          audio: false,
          video: {
            facingMode: "user", // 前置摄像头
            width: { ideal: captureWidth },
            height: { ideal: captureHeight },
            aspectRatio: { ideal: captureWidth / captureHeight },
          },
        };

        // 打开摄像头
        navigator.mediaDevices
          .getUserMedia(mediaConstraints)
          .then((stream) => {
            this._getUserMediaSuccess(stream, onReady, onError);
          })
          .catch(onError);
      })
      .catch(onError);
  }

  onWindowResize() {
    // 视频尺寸同步
    if (!this.videoElement) {
      return;
    }

    this.parameters.displayWidth = DivWidth;
    this.parameters.displayHeight = DivHeight;

    this.videoElement.style.width = this.parameters.displayWidth + "px";
    this.videoElement.style.height = this.parameters.displayHeight + "px";
  }
}

export { ArToolkitSource };
