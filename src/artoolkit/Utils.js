export var Camera = null;
export var DivWidth = 0;
export var DivHeight = 0;

// 视频裁剪偏移（用于 object-fit: cover 场景下 landmark 坐标映射）
export var VideoCropOffset = { left: 0, top: 0, scaleX: 1, scaleY: 1 };

export function setGlobalData(camera, divWidth, divHeight) {
  Camera = camera;
  DivWidth = divWidth;
  DivHeight = divHeight;
}

/**
 * 设置视频裁剪偏移（由 ArToolkitBackGround 调用）
 */
export function setVideoCropOffset(left, top, scaleX, scaleY) {
  VideoCropOffset.left = left;
  VideoCropOffset.top = top;
  VideoCropOffset.scaleX = scaleX;
  VideoCropOffset.scaleY = scaleY;
}

/**
 * 将 MediaPipe landmark 归一化坐标（视频帧空间）转换为显示区域坐标（屏幕空间）
 * @param {number} landmarkX - landmark.x（0-1，相对于视频帧）
 * @param {number} landmarkY - landmark.y（0-1，相对于视频帧）
 * @returns {{x: number, y: number}} 屏幕坐标
 */
export function landmarkToScreen(landmarkX, landmarkY) {
  const { left, top, scaleX, scaleY } = VideoCropOffset;
  return {
    x: ((landmarkX - left) / scaleX) * DivWidth,
    y: ((landmarkY - top) / scaleY) * DivHeight,
  };
}

// 获取操作系统类型
// @returns {string} 操作系统类型
export function getSystemOS() {
  const userAgent = navigator.userAgent;

  // 检查 Windows Phone
  if (userAgent.indexOf("Windows Phone") > -1) {
    return "WP";
  }

  // 检查 Android
  if ((userAgent.indexOf("OpenHarmony") > -1 && userAgent.indexOf("Phone") > -1) || userAgent.indexOf("Android") > -1) {
    return "Android";
  }

  // 检查 iOS
  if (
    userAgent.indexOf("iPhone") > -1 ||
    userAgent.indexOf("iPad") > -1 ||
    userAgent.indexOf("iPod") > -1 ||
    (/Macintosh|Mac OS X/i.test(userAgent) && navigator.maxTouchPoints > 1)
  ) {
    return "iOS";
  }

  // 检查 MacOS
  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return "MacOS";
  }

  // 其他操作系统
  return "Others";
}

// 检查是否为桌面操作系统
// @returns {boolean} 是否为桌面操作系统
export function isDesktopOS() {
  // 获取设备系统类型
  const osType = getSystemOS();
  return ["Others", "MacOS"].includes(osType);
}

export function isMobile() {
  // 获取设备系统类型
  const osType = getSystemOS();
  return !["Others", "MacOS"].includes(osType);
}

/**
 * 屏幕2D坐标 → 3D世界坐标（带输出向量，性能更高）
 * @param {number} screenX - 屏幕X坐标
 * @param {number} screenY - 屏幕Y坐标
 * @param {THREE.Vector3} targetVector - 接收结果的目标向量
 * @returns {THREE.Vector3} 转换后的3D坐标
 */
export function convertTo3DCoordinateTo(screenX, screenY, targetVector) {
  // 没有传入目标向量则返回 null
  if (!targetVector) {
    return null;
  }

  // 屏幕坐标 → 设备标准化坐标 NDC（范围 [-1, 1]）
  const ndcX = (screenX / DivWidth) * 2 - 1;
  const ndcY = (-screenY / DivHeight) * 2 + 1;

  // 设置目标向量：Z=0.9 表示在相机近裁剪面附近
  targetVector.set(ndcX, ndcY, 0.9);

  // 执行unproject：将NDC坐标反投影为3D世界坐标
  targetVector.unproject(Camera);

  return targetVector;
}

export function mapRange(e, t, n, r, i) {
  return ((e - t) * (i - r)) / (n - t) + r;
}

// 资源路径常量
export const RESOURCE_PATH = {
  HDR: "http://127.0.0.1:8080/web/WebHdrs/textures/Hdrs/defGem1/",
  MEDIAPIPE_WASM: "http://127.0.0.1:8080/web/tryon-models/wasm",
  MEDIAPIPE_MODEL: "http://127.0.0.1:8080/web/tryon-models/face_landmarker.task",
  DRACO_DECODER: "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
};
