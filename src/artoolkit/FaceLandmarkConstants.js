/**
 * MediaPipe Face Mesh 468 关键点常量定义
 * 将数字索引转换为具名常量，提高代码可读性
 */

/*
//第1,8，6，164,151，18,200，10,152，21,251，127，356，469，468，471，  474，476，473，4, 48, 193, 278, 417，几个位置对应哪里

MediaPipe Face Mesh 468 关键点
常用点位速查表（最准版本）
一、额头 / 眉间
10 额头中心顶部 天中
151 额头顶部下面一点 天庭
9 额头中心印堂 印堂
8 眉心 山根
168 眼珠中间
6 年上 168（眼珠中间）下面一点

二、鼻子（你最常用的一组）
1：鼻尖
4：鼻头
5 鼻头上面一点

200 左鼻翼外侧
48 左鼻翼内侧
278 右鼻翼外侧

三、眼睛

右眼（从人脸视角看）
33：右眼外眼角
133：右眼内眼角
159：右眼上眼睑中点
145：右眼下眼睑中点
468～477：右眼虹膜（瞳孔区域）
469，468，471 右眼瞳孔区域

193 眼珠中间（168） 左侧
417 眼珠中间（168） 右侧


左眼
362：左眼外眼角
263：左眼内眼角
386：左眼上眼睑中点
374：左眼下眼睑中点
478～487：左眼虹膜
474，476，473 左眼瞳孔区域

四、眉毛
107～110：右眉
336～339：左眉

五、嘴巴 / 嘴唇
0 上嘴唇顶
11 上嘴唇顶下
12 上嘴唇中
13：上唇底

14：下唇顶
15 下嘴唇顶下
16 下嘴唇中
17：下唇底

152 下巴尖

78：左嘴角
308：右嘴角

0, 11, 12, 16：唇线外围

六、脸部轮廓
10～17：右脸轮廓
127～139：左脸轮廓
152：下巴尖

七、你之前用到的三个点总结

164 人中
18：承浆
200 颂堂
199 地阁

21 位于 ‌右眼眶上缘‌，靠近 ‌右眉毛内侧末端下方‌，属于眼周区域的关键点，常用于定位右眼位置或提取眉毛动作特征
251 位于 ‌左眼眶上缘‌，对应 ‌左眉毛内侧末端下方‌，是右眼21点的镜像对称点，同样用于眼周或眉毛运动分析

127  左太阳穴
356  右太阳穴

*/

export const FaceLandmark = {
  // 额头 / 眉间
  FOREHEAD_CENTER_TOP: 10, // 额头中心顶部（天中）
  FOREHEAD_TOP_BELOW: 151, // 额头顶部下面一点（天庭）
  FOREHEAD_CENTER: 9, // 额头中心（印堂）
  BROW_CENTER: 8, // 眉心（山根）
  EYE_PUPIL_CENTER_REF: 168, // 眼珠中间参考点
  YEAR_UPPER: 6, // 年上（眼珠中间下方一点）

  // 鼻子
  NOSE_TIP: 1, // 鼻尖
  NOSE_HEAD: 4, // 鼻头
  NOSE_HEAD_ABOVE: 5, // 鼻头上面一点
  NOSE_LEFT_WING_OUTER: 200, // 左鼻翼外侧
  NOSE_LEFT_WING_INNER: 48, // 左鼻翼内侧
  NOSE_RIGHT_WING_OUTER: 278, // 右鼻翼外侧

  // 右眼（从人脸视角）
  RIGHT_EYE_OUTER_CORNER: 33, // 右眼外眼角
  RIGHT_EYE_INNER_CORNER: 133, // 右眼内眼角
  RIGHT_EYE_UPPER_LID: 159, // 右眼上眼睑中点
  RIGHT_EYE_LOWER_LID: 145, // 右眼下眼睑中点
  RIGHT_EYE_PUPIL_LEFT_REF: 193, // 眼珠中间左侧
  LEFT_EYE_PUPIL_RIGHT_REF: 417, // 眼珠中间右侧
  RIGHT_IRIS_CENTER: 468, // 右眼虹膜中心
  RIGHT_IRIS_LEFT: 469, // 右眼瞳孔区域左
  RIGHT_IRIS_RIGHT: 471, // 右眼瞳孔区域右

  // 左眼
  LEFT_EYE_OUTER_CORNER: 362, // 左眼外眼角
  LEFT_EYE_INNER_CORNER: 263, // 左眼内眼角
  LEFT_EYE_UPPER_LID: 386, // 左眼上眼睑中点
  LEFT_EYE_LOWER_LID: 374, // 左眼下眼睑中点
  LEFT_IRIS_CENTER: 473, // 左眼虹膜中心
  LEFT_IRIS_LEFT: 474, // 左眼瞳孔区域左
  LEFT_IRIS_RIGHT: 476, // 左眼瞳孔区域右

  // 眉毛
  RIGHT_EYEBROW_START: 107, // 右眉起始
  RIGHT_EYEBROW_END: 110, // 右眉结束
  LEFT_EYEBROW_START: 336, // 左眉起始
  LEFT_EYEBROW_END: 339, // 左眉结束

  // 嘴巴 / 嘴唇
  UPPER_LIP_TOP: 0, // 上嘴唇顶
  UPPER_LIP_TOP_BELOW: 11, // 上嘴唇顶下
  UPPER_LIP_CENTER: 12, // 上嘴唇中
  UPPER_LIP_BOTTOM: 13, // 上唇底
  LOWER_LIP_TOP: 14, // 下唇顶
  LOWER_LIP_TOP_BELOW: 15, // 下嘴唇顶下
  LOWER_LIP_CENTER: 16, // 下嘴唇中
  LOWER_LIP_BOTTOM: 17, // 下唇底
  MOUTH_LEFT_CORNER: 78, // 左嘴角
  MOUTH_RIGHT_CORNER: 308, // 右嘴角

  // 下巴
  CHIN_TIP: 152, // 下巴尖

  // 脸部轮廓
  RIGHT_FACE_CONTOUR_START: 10, // 右脸轮廓起始
  RIGHT_FACE_CONTOUR_END: 17, // 右脸轮廓结束
  LEFT_FACE_CONTOUR_START: 127, // 左脸轮廓起始
  LEFT_FACE_CONTOUR_END: 139, // 左脸轮廓结束

  // 特殊位置
  PHILTRUM: 164, // 人中
  CHENGJIANG: 18, // 承浆（下巴下方）
  SUN_TANG: 200, // 颂堂
  DI_GE: 199, // 地阁
  RIGHT_EYE_SOCKET_UPPER: 21, // 右眼眶上缘（眉毛内侧末端下方）
  LEFT_EYE_SOCKET_UPPER: 251, // 左眼眶上缘（眉毛内侧末端下方）
  LEFT_TEMPLE: 127, // 左太阳穴
  RIGHT_TEMPLE: 356, // 右太阳穴
};

/**
 * 获取眉心（山根）特征点索引
 */
export function getBrowCenterIndex() {
  return FaceLandmark.BROW_CENTER;
}

/**
 * 获取年上特征点索引（眼珠中间参考点下方）
 */
export function getYearUpperIndex() {
  return FaceLandmark.YEAR_UPPER;
}

/**
 * 获取额头顶部下方索引（天庭）
 */
export function getForeheadTopBelowIndex() {
  return FaceLandmark.FOREHEAD_TOP_BELOW;
}

/**
 * 获取承浆特征点索引（下巴下方）
 */
export function getChengjiangIndex() {
  return FaceLandmark.CHENGJIANG;
}

/**
 * 获取左鼻翼外侧索引
 */
export function getNoseLeftWingOuterIndex() {
  return FaceLandmark.NOSE_LEFT_WING_OUTER;
}

/**
 * 获取右眼眶上缘索引（用于耳根定位）
 */
export function getRightEyeSocketUpperIndex() {
  return FaceLandmark.RIGHT_EYE_SOCKET_UPPER;
}

/**
 * 获取左眼眶上缘索引（用于耳根定位）
 */
export function getLeftEyeSocketUpperIndex() {
  return FaceLandmark.LEFT_EYE_SOCKET_UPPER;
}

/**
 * 获取鼻尖特征点索引
 */
export function getNoseTipIndex() {
  return FaceLandmark.NOSE_TIP;
}

/**
 * 获取人中特征点索引
 */
export function getPhiltrumIndex() {
  return FaceLandmark.PHILTRUM;
}

/**
 * 获取右眼虹膜中心索引
 */
export function getRightIrisCenterIndex() {
  return FaceLandmark.RIGHT_IRIS_CENTER;
}

/**
 * 获取左眼虹膜中心索引
 */
export function getLeftIrisCenterIndex() {
  return FaceLandmark.LEFT_IRIS_CENTER;
}

/**
 * 获取右眼瞳孔区域左索引
 */
export function getRightIrisLeftIndex() {
  return FaceLandmark.RIGHT_IRIS_LEFT;
}

/**
 * 获取右眼瞳孔区域右索引
 */
export function getRightIrisRightIndex() {
  return FaceLandmark.RIGHT_IRIS_RIGHT;
}

/**
 * 获取左眼瞳孔区域左索引
 */
export function getLeftIrisLeftIndex() {
  return FaceLandmark.LEFT_IRIS_LEFT;
}

/**
 * 获取左眼瞳孔区域右索引
 */
export function getLeftIrisRightIndex() {
  return FaceLandmark.LEFT_IRIS_RIGHT;
}

/**
 * 获取额头中心顶部索引（用于头部距离检测）
 */
export function getForeheadCenterTopIndex() {
  return FaceLandmark.FOREHEAD_CENTER_TOP;
}

/**
 * 获取下巴尖索引（用于头部距离检测）
 */
export function getChinTipIndex() {
  return FaceLandmark.CHIN_TIP;
}

/**
 * 获取左太阳穴索引（用于脸部宽度计算）
 */
export function getLeftTempleIndex() {
  return FaceLandmark.LEFT_TEMPLE;
}

/**
 * 获取右太阳穴索引（用于脸部宽度计算）
 */
export function getRightTempleIndex() {
  return FaceLandmark.RIGHT_TEMPLE;
}

/**
 * 获取面部遮罩关键点索引数组（鼻尖、左鼻翼内侧、右眼瞳孔左参考、右鼻翼外侧、左眼瞳孔右参考）
 */
export function getFaceMeshPoints() {
  return [
    FaceLandmark.NOSE_HEAD,
    FaceLandmark.NOSE_LEFT_WING_INNER,
    FaceLandmark.RIGHT_EYE_PUPIL_LEFT_REF,
    FaceLandmark.NOSE_RIGHT_WING_OUTER,
    FaceLandmark.LEFT_EYE_PUPIL_RIGHT_REF,
  ];
}

/**
 * 获取Glasses模式鼻尖参考点索引（右侧眉心、左侧年上）
 */
export function getGlassesNoseRefPoints() {
  return [FaceLandmark.BROW_CENTER, FaceLandmark.YEAR_UPPER];
}

/**
 * 获取Hat模式额头参考点索引（额头顶部、额头顶部下方）
 */
export function getHatForeheadRefPoints() {
  return [FaceLandmark.FOREHEAD_CENTER_TOP, FaceLandmark.FOREHEAD_TOP_BELOW];
}

/**
 * 获取Mask模式脸颊参考点索引（承浆、左鼻翼外侧）
 */
export function getMaskCheekRefPoints() {
  return [FaceLandmark.CHENGJIANG, FaceLandmark.NOSE_LEFT_WING_OUTER];
}
