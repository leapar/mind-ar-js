# face-target (MindAR) vs artoolkit 深度对比分析

> 两套系统都基于 MediaPipe FaceLandmarker 做人脸检测，但在特征点处理、位姿估计、应用架构上存在根本性差异。

---

## 一、整体定位对比

| 维度 | face-target (MindAR) | artoolkit (TryOn) |
|------|----------------------|-------------------|
| **定位** | 通用 3D 人脸 AR 框架 | 专用 AR 试戴引擎（眼镜/帽子/口罩） |
| **抽象层级** | 底层：从关键点检测到位姿估计全链路 | 中层：直接消费 MediaPipe 输出，聚焦业务逻辑 |
| **核心产出** | 468 个 3D 度量关键点 + 4×4 位姿矩阵 | 头部位置/旋转/缩放 → 驱动 3D 模型 |
| **依赖的 MediaPipe 输出** | 仅 `faceLandmarks`（468 关键点） | `faceLandmarks` + `facialTransformationMatrixes` + `faceBlendshapes` |
| **是否自研位姿估计** | 是：自定义 Estimator（Procrustes + solvePnP） | 否：直接使用 MediaPipe 自带的 `facialTransformationMatrixes` |
| **OpenCV 依赖** | 是：SVD、solvePnP、Rodrigues、矩阵求逆 | 否：纯 Three.js |
| **Three.js 版本** | 较新版本（CSS3DRenderer add-ons） | 固定 0.144.0 |

---

## 二、检测器配置对比

### 2.1 MediaPipe FaceLandmarker 初始化

| 参数 | face-target | artoolkit |
|------|-------------|-----------|
| `runningMode` | `"IMAGE"`（图像模式） | `"VIDEO"`（视频模式） |
| `delegate` | `"GPU"` | `"GPU"` |
| `outputFaceBlendshapes` | `true` | `true` |
| `outputFacialTransformationMatrixes` | **false**（注释掉了） | **true** ★ |
| `numFaces` | `1` | `1` |
| `canvas` | 不指定 | 创建隐藏 `aiCanvas` |

**关键差异**: artoolkit 开启了 `outputFacialTransformationMatrixes`，直接获取 MediaPipe 内置的 4×4 变换矩阵，完全跳过了自研位姿估计。而 face-target 关闭了这个选项，自己从零重建。

### 2.2 检测输入处理

**face-target** — 直接传入 video 或翻转后的 canvas:
```js
// 前置摄像头时水平翻转
if (this.flipFace) {
  flippedInputContext.drawImage(input, ...);
  results = await this.faceMeshHelper.detect(flippedCanvasElement);
} else {
  results = await this.faceMeshHelper.detect(input);
}
```

**artoolkit** — 先缩放到 600px 再检测:
```js
const maxSize = 600;
const scale = Math.min(1, maxSize / Math.min(videoW, videoH));
const targetW = Math.round(videoW * scale);
const targetH = Math.round(videoH * scale);
this._arDetectCtx.drawImage(videoElement, 0, 0, videoW, videoH, 0, 0, targetW, targetH);
results = this.faceLandmarker.detectForVideo(this.arDetectCanvas, timestamp);
```

**差异**: artoolkit 对输入做了降采样（最大 600px），在移动端可以提升检测性能；face-target 直接用原始分辨率输入。

---

## 三、人脸特征点处理 — 核心差异

这是两套系统最根本的分水岭。

### 3.1 face-target 的特征点处理流程

```
MediaPipe 归一化关键点 [[x,y,z] ∈ [0,1]]
    │
    │ _projectToScreen() — 归一化 → 虚拟相机屏幕坐标
    ▼
屏幕坐标（近裁剪面）
    │
    │ 两阶段迭代估计尺度
    │   第一次: _estimateScale(screen landmarks)
    │   第二次: _estimateScale(3D landmarks after unproject)
    ▼
metricLandmarks（真实世界度量坐标，毫米级）
    │
    │ _solveWeightedOrthogonal() — 加权 Procrustes 对齐标准模型
    ▼
poseTransformMat（canonical → metric 的 4×4 变换）
    │
    │ 逆变换 + solvePnP 精化
    ▼
newMetricLandmarks（最终 3D 坐标）+ faceMatrix（4×4 位姿矩阵）+ faceScale
```

**核心思想**: MediaPipe 只给出相对深度，没有真实尺度。通过两阶段迭代 + 标准模型对齐（canonical face model）恢复毫米级度量，然后用 solvePnP 求精确相机位姿。

### 3.2 artoolkit 的特征点处理流程

```
MediaPipe 归一化关键点 [[x,y,z] ∈ [0,1]]
    │
    │ 不做 3D 重建，直接使用归一化坐标
    ▼
landmarkToScreen() — 归一化 → 屏幕像素坐标
    │  （考虑 object-fit: cover 裁剪偏移）
    ▼
screen (x, y)
    │
    │ convertTo3DCoordinateTo() — 屏幕 NDC → 3D 世界坐标
    ▼
3D 世界坐标（通过 unproject 反投影）
    │
    │ 直接使用 facialTransformationMatrixes 获取位姿
    ▼
position (Vector3) + euler (Euler) + scale (Vector3)
```

**核心思想**: 不做 3D 重建，将 2D 屏幕点通过相机 unproject 到 3D 射线，配合 MediaPipe 自带的变换矩阵直接驱动 3D 模型。

### 3.3 坐标系映射对比

| 步骤 | face-target | artoolkit |
|------|-------------|-----------|
| 2D 到屏幕 | `_projectToScreen`: 基于虚拟相机视锥体 | `landmarkToScreen`: 基于视频裁剪偏移 + 容器尺寸 |
| 2D 到 3D | `_unprojectScreen`: `x_3d = x_screen * z / near` | `convertTo3DCoordinateTo`: NDC 反投影 `unproject(camera)` |
| 3D 度量 | 通过 Procrustes 从标准模型继承尺度 | 无真实度量，深度固定为 `0.9` 近裁剪面 |
| 坐标精度 | 毫米级（标准模型约束） | 屏幕投影级（依赖相机参数） |

### 3.4 视频裁剪偏移处理

**artoolkit 独有**: 当视频以 `object-fit: cover` 方式显示时，视频帧与显示区域存在裁剪偏移。artoolkit 通过 `_videoCropOffset` 精确计算这个偏移:

```js
// 视频更宽 → 左右裁剪
const cropLeft = (videoW - displayWInVideo) / 2;
const normalizedLeft = cropLeft / videoW;
// landmark 映射: screenX = ((landmarkX - normalizedLeft) / scaleX) * DivWidth
```

**face-target**: 不涉及这个概念，因为它的 Estimator 直接在视频帧空间工作，不映射到屏幕像素。

---

## 四、位姿估计原理对比

### 4.1 face-target: 自研 Estimator（6 步精密管线）

```
第 1 步: 投影 — 归一化坐标映射到虚拟近裁剪面
第 2 步: 尺度估计(1) — Procrustes 在屏幕空间粗略估计
第 3 步: 反投影 — 屏幕 2D → 3D 空间
第 4 步: 尺度估计(2) — Procrustes 在 3D 空间精化
第 5 步: Procrustes 对齐 — canonical 模型对齐到估计的度量空间
第 6 步: solvePnP — 相机投影约束求精确位姿
```

**数学基础**:
- 加权正交 Procrustes（Kabsch Algorithm + SVD）
- OpenCV solvePnP（Perspective-n-Point）
- Rodrigues 旋转向量 → 旋转矩阵
- 4×4 齐次坐标变换 + 逆矩阵

**输出**:
- `metricLandmarks`: 468 个 3D 度量坐标
- `faceMatrix`: 4×4 齐次变换矩阵（行主序）
- `faceScale`: 人脸宽度（左右边界距离）

### 4.2 artoolkit: 消费 MediaPipe 内置矩阵

```js
// MediaPipe 输出的 4×4 变换矩阵（Float32Array(16)）
const facialMatrixData = this.results.facialTransformationMatrixes[0].data;

// 填充 Three.js Matrix4
_mpTmpMat4.set(
  facialMatrixData[0], facialMatrixData[1], facialMatrixData[2], facialMatrixData[3],
  facialMatrixData[4], facialMatrixData[5], facialMatrixData[6], facialMatrixData[7],
  facialMatrixData[8], facialMatrixData[9], facialMatrixData[10], facialMatrixData[11],
  facialMatrixData[12], facialMatrixData[13], facialMatrixData[14], facialMatrixData[15],
);

// 转置 + 分解
_mpTmpMat4.transpose().decompose(_mpTmpPos, _mpTmpQuat, _mpTmpScale);
```

**MediaPipe 的变换矩阵**: MediaPipe 内部有自己的几何管线（与 face-target 的 Estimator 原理相似，但实现不同），直接输出一个从 canonical 空间到相机空间的 4×4 矩阵。

**artoolkit 的额外处理**:
- 矩阵转置（MediaPipe 是列主序，Three.js 是行主序）
- 分解为 position / quaternion / scale
- 前置摄像头时 Y 轴翻转: `tempEuler.y = -tempEuler.y`
- 左侧旋转限制: `_limitLeftRotation()` 防止过度左转
- 眼镜模式旋转平滑: `_applyGlassesRotationSmoothing()` 自适应低通滤波

### 4.3 位姿数据用途对比

| 位姿数据 | face-target 用法 | artoolkit 用法 |
|----------|------------------|----------------|
| faceMatrix / transformationMatrix | 直接设为 Three.js Anchor 的 `matrix` | 分解为 position/quaternion/scale |
| metricLandmarks | 驱动动态 FaceGeometry 顶点 | 不参与 |
| faceScale | OneEuroFilter 滤波 | 不参与 |
| position | 不参与 | headNode 定位 + 模型位置计算 |
| euler | 不参与 | 模型旋转 + 遮挡判断 + 角度映射 |
| scale | 不参与 | 眼镜/帽子/口罩模型缩放 |

---

## 五、特征点语义使用对比

### 5.1 face-target 的特征点使用

face-target **不关心语义**，468 个点全部参与计算：
- **Procrustes**: 全部 468 个点，但通过 `landmarkBasis` 加权（33 个高权重点）
- **solvePnP**: 选 `majorLandmarkIndexes`（约 38 个点），包含眼角和加权索引

```js
// 权重分布（landmarkBasis）
// 最高权重: 眼中心 [129, 358] → 0.1206
// 高权重: 眼内角 [136, 365] → 0.0669
// 中高权重: 眼上睑 [133, 362] → 0.0533
// 中等权重: 眼角 [33, 263] → 0.0587
// 低权重: 其他点 → 0
```

### 5.2 artoolkit 的特征点使用

artoolkit **高度关注语义**，通过 `FaceLandmarkConstants.js` 定义了具名常量:

| 功能 | 使用的关键点 | 用途 |
|------|-------------|------|
| **瞳距测量** | 468, 469, 471, 473, 474, 476（虹膜） | 眼镜自动缩放核心公式 |
| **眉心定位** | 8（山根） | headNode 位置基准 |
| **鼻尖参考** | 1（鼻尖） | 试戴方向计算 |
| **人中** | 164 | 调试显示 |
| **额头-下巴** | 10（天中）, 152（下巴尖） | 头部距离检测 |
| **太阳穴** | 127（左）, 356（右） | 脸部宽度 3D 计算 |
| **耳根定位** | 21（右眼框上缘）, 251（左眼框上缘） | 眼镜宽度自适应 |
| **眼镜方向** | 8（眉心）, 6（年上） | 鼻尖方向向量 |
| **帽子方向** | 10, 151 | 额头方向向量 |
| **口罩方向** | 18（承浆）, 200（左鼻翼外侧） | 脸颊方向向量 |
| **面部遮挡面片** | 4, 48, 193, 278, 417 | 防止模型穿脸的 5 点面片 |

**artoolkit 的核心公式 — 瞳距缩放**:
```js
// 测量: 左右瞳孔中心距离 / 平均瞳孔内径 × 11.7mm（标准比例）
const pupilCenterDist = distance(landmarks[468], landmarks[473]);
const avgPupilInnerDist = (distance(469,471) + distance(474,476)) / 2;
const measuredPupilDistance = (pupilCenterDist / avgPupilInnerDist) * 11.7;

// 眼镜缩放: 基础缩放 × 基准瞳距 / 实际瞳距 × 旋转映射 × 深度映射
scale = glassScale * pupilScaleRef / effectivePupilDist * mappedRotY * (mapPosMaxZ / pos.z) / mappedPosZ;
```

---

## 六、滤波与稳定策略对比

### 6.1 face-target: OneEuroFilter（一欧元滤波器）

```js
// 滤波器配置
this.landmarkFilters[468]  // 每个关键点一个滤波器（过滤 x, y, z）
this.faceMatrixFilter       // 过滤整体 4×4 变换矩阵
this.faceScaleFilter        // 过滤人脸尺寸

// 参数
filterMinCF = 0.001  // 最小截止频率 1Hz
filterBeta = 1       // 速度系数
```

**特点**:
- 自适应: 根据信号变化速度动态调整平滑强度
- 快速运动时提高截止频率（降低延迟）
- 静止时降低截止频率（强平滑）
- 失脸时全部重置: `filter.reset()`

### 6.2 artoolkit: 自适应低通滤波（仅眼镜模式）

```js
// 仅对 Y/Z 轴欧拉角做平滑
_applyGlassesRotationSmoothing() {
  const MOTION_EPSILON = 0.012;  // 运动检测阈值
  const SMOOTH_ALPHA = 0.22;     // 静止平滑系数

  // 快速转头时: 直接使用原始角度（不延迟）
  if (isMoving) {
    smoothed.copy(raw);
  }
  // 静止/慢速时: 低通滤波平滑
  else {
    smoothed.y += (raw.y - smoothed.y) * SMOOTH_ALPHA;
    smoothed.z += (raw.z - smoothed.z) * SMOOTH_ALPHA;
  }
}
```

**特点**:
- 只对旋转做滤波，不做关键点滤波
- 运动检测: 角度变化 > 0.012 rad 认为是快速转头，直接同步
- 简单指数移动平均 (EMA)，比 OneEuroFilter 轻量但不如自适应

### 6.3 对比总结

| 维度 | face-target | artoolkit |
|------|-------------|-----------|
| 滤波对象 | 468×3 关键点 + faceMatrix + faceScale | 仅欧拉角 Y/Z |
| 算法 | OneEuroFilter（自适应截止频率） | EMA（固定系数 + 运动检测旁路） |
| 参数 | minCutOff=0.001, beta=1 | alpha=0.22, motionThreshold=0.012 |
| 失脸处理 | 全部 reset | 不做特殊处理 |
| 计算量 | 大（470 个滤波器实例） | 小（1 个 EMA） |

---

## 七、遮挡处理对比

### 7.1 face-target: 无遮挡逻辑

face-target 不提供遮挡机制。它只输出锚点和 FaceGeometry，遮挡由上层自行处理。

### 7.2 artoolkit: 多层深度遮挡系统

artoolkit 实现了 **5 层遮挡系统**，防止 3D 模型穿脸:

| 遮挡层 | 几何体 | 用途 | 触发条件 |
|--------|--------|------|---------|
| **faceMesh** | 5 点三角面片 | 基础防穿脸 | 始终开启 |
| **headOccluder** | CapsuleGeometry(0.1, 0.42) | 头部主遮挡 | 眼镜模式 |
| **headOccluder1** | CapsuleGeometry(0.055, 0.42) + Y轴渐变 | 头部渐变遮挡 | 眼镜模式 |
| **glassOCMesh** | 3 层 Box (Z渐变/Y渐变/实心) | 眼镜侧脸遮挡 | 偏转角度 > 0.12 rad |
| **maskOCMesh** | CapsuleGeometry(0.104, 0.3) | 口罩遮挡 | 口罩模式 |
| **hatOCMesh** | CapsuleGeometry(0.075, 0.03) | 帽子遮挡 | 帽子模式 |

**faceMesh 5 个关键点**:
```
[4(鼻尖), 48(左鼻翼内侧), 193(右眼瞳孔左), 278(右鼻翼外侧), 417(左眼瞳孔右)]
```

**遮挡材质技术**:
- `colorWrite: false` — 不输出颜色，只写深度
- `depthWrite: true` — 写入深度缓冲区
- `renderOrder: -Infinity` — 最先渲染
- 拜耳抖动 (Bayer Dither 4×4) — 实现平滑透明度渐变
- 自定义 shader (`onBeforeCompile`) — Z 轴/Y 轴渐变遮挡

---

## 八、3D 渲染架构对比

### 8.1 face-target: 锚点驱动

```js
// 用户创建锚点，系统自动绑定到关键点
addAnchor(landmarkIndex) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  // 每帧: group.matrix = controller.getLandmarkMatrix(landmarkIndex)
}

// 或者创建动态人脸网格
addFaceMesh() {
  const faceGeometry = controller.createThreeFaceGeometry(THREE);
  const faceMesh = new THREE.Mesh(faceGeometry, material);
  // 每帧: faceGeometry.updatePositions(metricLandmarks)
}
```

**渲染层**:
- WebGLRenderer（3D 内容）
- CSS3DRenderer（DOM 元素 3D 化）
- 双场景: scene + cssScene
- 视频背景: CSS 定位（z-index: -2）

### 8.2 artoolkit: headNode 驱动

```js
// 所有 3D 模型挂在 rootNode 下
// headNode 跟随眉心位置
this.headNode.position.copy(eyebrowWorldPos);
this.headNode.quaternion.copy(_mpTmpQuat);

// 模型旋转/缩放直接操作 rootNode
this.rootNode.rotation.set(pitch, -yaw, -roll);
this.rootNode.scale.copy(calculatedScale);
```

**渲染层**:
- WebGLRenderer（主 3D 内容）
- 独立 bgRenderer（视频背景，正交相机 + PlaneGeometry + VideoTexture）
- takeRender Canvas（调试绘制人脸网格）
- HDR 环境贴图（RGBELoader）

---

## 九、应用层功能对比

### 9.1 face-target 功能

| 功能 | 说明 |
|------|------|
| Anchor 系统 | 在任意关键点挂载 3D/CSS 内容 |
| FaceMesh | 动态人脸网格（468 顶点） |
| Blendshapes | 输出 52 个表情系数 |
| 相机同步 | 自动同步 Three.js 相机参数到 MediaPipe 估计 |
| 多摄像头 | switchCamera() 切换前后摄 |

### 9.2 artoolkit 功能

| 功能 | 说明 |
|------|------|
| 眼镜试戴 | 瞳距测量 → 自动缩放 → 耳根适配 |
| 帽子试戴 | 额头参考点 → 姿态补偿 |
| 口罩试戴 | 脸颊参考点 → 姿态补偿 |
| 鞋子试戴 | 瞳距缩放 + 深度映射 |
| 头部遮挡 | 多层胶囊遮挡 + 渐变 + 拜耳抖动 |
| 侧脸检测 | 旋转角度超限隐藏模型 |
| 头部距离检测 | 额头-下巴高度比判断远近 |
| 3D 预览模式 | 无摄像头 OrbitControls 预览 |
| GLB 模型加载 | DRACO 压缩 + 自动居中 |

---

## 十、关键算法对比汇总表

| 算法环节 | face-target | artoolkit |
|----------|-------------|-----------|
| **人脸检测** | MediaPipe FaceLandmarker (IMAGE模式) | MediaPipe FaceLandmarker (VIDEO模式) |
| **输入分辨率** | 原始分辨率 | 降采样到最大 600px |
| **3D 重建** | 两阶段迭代 + Procrustes + solvePnP | 无（直接消费 MediaPipe 输出） |
| **尺度恢复** | 加权 Procrustes 从标准模型继承 | 无真实尺度，依赖 unproject |
| **位姿矩阵来源** | 自研 Estimator（solvePnP） | MediaPipe facialTransformationMatrixes |
| **特征点语义** | 无（全部点参与数学计算） | 强语义（具名常量，按功能分组） |
| **特征点数量** | 468 全量参与 | 按需选取（瞳距用 6 点，遮挡用 5 点等） |
| **坐标系** | 自定虚拟相机 → 度量空间 | 屏幕 NDC → 3D 世界坐标 |
| **滤波** | OneEuroFilter（470 个实例） | EMA + 运动旁路（仅旋转） |
| **遮挡** | 无 | 5 层深度遮挡 + 拜耳抖动渐变 |
| **瞳距** | 无 | 虹膜关键点 3D 距离测量 → 11.7mm 标准换算 |
| **OpenCV** | SVD / solvePnP / Rodrigues / inv | 无 |
| **适用场景** | 通用 3D AR（锚点驱动） | 专用试戴（眼镜/帽子/口罩/鞋子） |

---

## 十一、总结: 为什么两套方案并存

### face-target 的优势
1. **精确的 3D 度量**: Procrustes + solvePnP 管线输出毫米级坐标，适合需要真实尺寸的场合
2. **不依赖 MediaPipe 位姿**: 自研 Estimator 完全可控，可以定制和调试
3. **通用框架**: 锚点系统可以挂载任何 3D 内容，不局限于试戴
4. **CSS3D 支持**: HTML 元素也能作为 AR 内容
5. **表情识别**: 输出 blendshapes 系数

### artoolkit 的优势
1. **业务逻辑丰富**: 瞳距测量、耳根适配、姿态补偿、多层遮挡，都是试戴场景的刚需
2. **性能更优**: 降采样输入 + 轻量 EMA 滤波，移动端更流畅
3. **消费 MediaPipe 内置矩阵**: 省去了自定义 Estimator 的复杂计算
4. **多层遮挡系统**: 防穿脸处理精细到拜耳抖动级别的渐变
5. **语义化关键点**: 具名常量让代码可读性强，业务逻辑清晰

### 核心差异一句话

> **face-target**: "从 2D 关键点重建 3D 人脸" — 自研数学管线，追求度量精度
>
> **artoolkit**: "把 2D 关键点映射到 3D 空间" — 消费 MediaPipe 输出，追求业务适配
