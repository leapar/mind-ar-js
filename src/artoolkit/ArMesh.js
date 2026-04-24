import {
  BufferGeometry,
  BufferAttribute,
  MeshBasicMaterial,
  LinearFilter,
  ClampToEdgeWrapping,
  Vector3,
  DoubleSide,
  Mesh,
  DataTexture,
  DynamicDrawUsage,
  CapsuleGeometry,
  Object3D,
  BoxGeometry,
} from "three";
import { convertTo3DCoordinateTo, DivWidth, DivHeight, mapRange, landmarkToScreen } from "./Utils.js";
import { FaceLandmark, getLeftTempleIndex, getRightTempleIndex, getFaceMeshPoints } from "./FaceLandmarkConstants.js";

const _mpTmpVec3A = new Vector3(); // 临时向量A
const _mpTmpVec3B = new Vector3();

//鼻尖 鼻梁 一个箭头遮罩模型
export class ArMesh {
  constructor(scene, rootNode, headNode) {
    this.scene = scene;
    this.rootNode = rootNode;
    this.headNode = headNode;

    this.faceMesh = null;
    this.faceGeoIndex = null;

    this.headOccluderMesh = null;
    this.headOccluderFadeStartY = 0.1;
    this.headOccluderFadeDistance = 0.06;
    this.headOccluderMesh1 = null;

    this._frontOcclusionSideTurnMode = false;

    // ======================================
    // 配置玻璃遮挡渐变参数（空值兜底默认值，防止未定义报错）
    // ======================================
    // 遮挡渐变参数
    this.frontOcclusionFadeStartZ = -0.02; // Z轴渐变起始位置
    this.frontOcclusionFadeDistance = 0.07; // Z轴渐变距离范围
    this.frontOcclusionTopFadeStartY = 0.05; // Y轴顶部渐变起始位置
    this.frontOcclusionTopFadeDistance = 0.06; // Y轴顶部渐变距离范围

    this.glassOCMesh = null;
    this.frontOCMesh = null;
    this.frontTopOCMesh = null;
    this.frontTopSolidOCMesh = null;

    this.maskOCMesh = null;
    this.isRhino5 = true;

    // 缓存的渐变纹理
    this.frontOcclusionFadeTexture = null;

    this.tryonConfig = {
      headOccluder: {
        baseRadius: 0.1,
        faceScaleMinLandscape: 0.75,
        faceScaleMinPortrait: 0.7,
        faceScaleMax: 2.5,
        zScale: 0.5,
        fallbackScaleXZ: 0.35,
        fallbackScaleY: 0.5,
        shrinkStart: 0.05,
        shrinkEnd: 1.05,
        minScale: 0.6,
        maxXOffsetLandscape: 0.021,
        maxXOffsetPortrait: 0.04,
      },
      headOccluder1: {
        baseRadius: 0.055,
        faceScaleMinLandscape: 0.75,
        faceScaleMinPortrait: 0.7,
        faceScaleMax: 2.5,
        zScale: 0.5,
        fallbackScaleXZ: 0.35,
        fallbackScaleY: 0.5,
        shrinkStart: 0.05,
        shrinkEnd: 1.05,
        minScale: 0.9,
        maxXOffsetLandscape: 0.008,
        maxXOffsetPortrait: 0.03,
      },
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
      frontOcclusionYawSwitch: {
        showAt: 0.12,
        hideAt: 0.08,
      },
    };

    this._init();
  }

  _init() {
    // 不存在则创建：5个点的面片 + 深度材质
    const geometry = new BufferGeometry();
    const positionArray = new Float32Array(15); // 5个点 xyz
    this.faceGeoIndex = new Uint16Array([0, 2, 1, 0, 2, 4, 0, 4, 3]);

    const positionAttr = new BufferAttribute(positionArray, 3);
    positionAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute("position", positionAttr);
    geometry.setIndex(new BufferAttribute(this.faceGeoIndex, 1));

    // 关键：只写深度，不画颜色（隐形遮罩）
    const depthMaterial = new MeshBasicMaterial({
      colorWrite: false,
      side: DoubleSide,
      depthWrite: true,
    });

    this.faceMesh = new Mesh(geometry, depthMaterial);
    this.faceMesh.name = "faceMesh";
    this.faceMesh.renderOrder = -Infinity;
    this.faceMesh.castShadow = false;
    this.faceMesh.receiveShadow = false;
    this.scene.add(this.faceMesh);
  }

  // 创建脸部深度遮罩（防止模型穿脸）
  updateFaceMesh(faceLandmarks) {
    if (!faceLandmarks?.[0]) {
      return;
    }

    // 有人脸检测结果时，更新面片位置贴在脸上

    const landmarks = faceLandmarks[0];
    // 脸部5个关键点：鼻头(4)、左鼻翼内侧(48)、右眼瞳孔左参考(193)、右鼻翼外侧(278)、左眼瞳孔右参考(417)
    const facePoints = getFaceMeshPoints();
    const positionAttr = this.faceMesh.geometry.getAttribute("position");

    for (let i = 0; i < facePoints.length; i++) {
      const landmarkIndex = facePoints[i];
      const point = landmarks[landmarkIndex];
      if (!point) continue;

      // 转为3D坐标（自动处理视频裁剪偏移）
      const screenPt = landmarkToScreen(point.x, point.y);
      convertTo3DCoordinateTo(screenPt.x, screenPt.y, _mpTmpVec3A);

      // 一堆微调位置，让面片更贴合人脸
      if (landmarkIndex === FaceLandmark.NOSE_HEAD) {
        _mpTmpVec3A.y -= 3;
        _mpTmpVec3A.z += 2;
        if (DivHeight > DivWidth) {
          _mpTmpVec3A.z += 1;
        }
      }
      if (landmarkIndex === FaceLandmark.RIGHT_EYE_PUPIL_LEFT_REF || landmarkIndex === FaceLandmark.LEFT_EYE_PUPIL_RIGHT_REF) {
        _mpTmpVec3A.z -= 3;
      }
      if (landmarkIndex === FaceLandmark.NOSE_LEFT_WING_INNER) {
        if (DivWidth >= DivHeight) {
          _mpTmpVec3A.x -= 0.4;
          _mpTmpVec3A.z -= 6;
        }
      }
      if (landmarkIndex === FaceLandmark.NOSE_RIGHT_WING_OUTER) {
        if (DivWidth >= DivHeight) {
          _mpTmpVec3A.x += 0.4;
          _mpTmpVec3A.z -= 6;
        }
      }

      // 设置面片顶点
      positionAttr.setXYZ(i, -_mpTmpVec3A.x, _mpTmpVec3A.y, _mpTmpVec3A.z);
    }

    positionAttr.needsUpdate = true;
  }

  /**
   * 获取前端遮挡渐变纹理（单通道透明度渐变纹理，用于着色器渐变遮挡）
   * 生成一个 256x1 的灰度渐变纹理，透明度使用指数曲线增强渐变效果
   * @returns {THREE.DataTexture} 渐变遮挡纹理
   */
  _getFrontOcclusionFadeTexture() {
    // 单例模式：如果纹理已经创建，直接复用，避免重复创建浪费性能
    if (this.frontOcclusionFadeTexture) {
      return this.frontOcclusionFadeTexture;
    }

    // ====================== 纹理配置 ======================
    const textureWidth = 256; // 纹理宽度（256像素）
    const textureHeight = 1; // 纹理高度（1像素，横向渐变）
    const channels = 4; // RGBA 4个通道
    const pixelCount = textureWidth; // 总像素数量
    const bufferSize = pixelCount * channels; // 缓冲区总长度：256 * 4 = 1024

    // 创建无符号8位数组，存储纹理像素数据
    const pixelData = new Uint8Array(bufferSize);

    // ====================== 生成渐变像素 ======================
    for (let index = 0; index < textureWidth; index++) {
      // 0~1 归一化渐变因子
      const normalizedValue = index / 255;

      // 透明度指数曲线：pow(1.35) 让渐变更自然，不是线性变化
      const alphaValue = Math.round(255 * Math.pow(normalizedValue, 1.35));

      // 计算当前像素在数组中的起始索引（每个像素占4位：R G B A）
      const pixelOffset = 4 * index;

      // R = 255（纯白）
      pixelData[pixelOffset] = 255;
      // G = 255（纯白）
      pixelData[pixelOffset + 1] = 255;
      // B = 255（纯白）
      pixelData[pixelOffset + 2] = 255;
      // A = 计算出的透明度（核心渐变值）
      pixelData[pixelOffset + 3] = alphaValue;
    }

    // ====================== 创建Three.js数据纹理 ======================
    // Oi = THREE.DataTexture
    const fadeTexture = new DataTexture(
      pixelData, // 像素数据数组
      textureWidth, // 宽度
      textureHeight, // 高度
    );

    // 纹理包裹模式：z = THREE.ClampToEdgeWrapping（边缘截断，不重复）
    fadeTexture.wrapS = ClampToEdgeWrapping;
    fadeTexture.wrapT = ClampToEdgeWrapping;

    // 纹理过滤模式：j = THREE.LinearFilter（线性过滤，平滑渐变）
    fadeTexture.minFilter = LinearFilter;
    fadeTexture.magFilter = LinearFilter;

    // 关闭Mipmap（渐变纹理不需要多级纹理）
    fadeTexture.generateMipmaps = false;

    // 标记纹理需要更新
    fadeTexture.needsUpdate = true;

    // 缓存到实例，下次直接复用
    this.frontOcclusionFadeTexture = fadeTexture;

    return fadeTexture;
  }

  _getFaceWidth3D(faceLandmarks) {
    // 检查人脸关键点数据是否有效
    if (!faceLandmarks) {
      return -1;
    }

    if (faceLandmarks.length < 357) {
      return -1;
    }

    // 左太阳穴(127) / 右太阳穴(356)
    const leftCheekPoint = faceLandmarks[getLeftTempleIndex()];
    const rightCheekPoint = faceLandmarks[getRightTempleIndex()];

    // 转为 3D 世界坐标（自动处理视频裁剪偏移）
    const leftScreen = landmarkToScreen(leftCheekPoint.x, leftCheekPoint.y);
    const rightScreen = landmarkToScreen(rightCheekPoint.x, rightCheekPoint.y);
    convertTo3DCoordinateTo(leftScreen.x, leftScreen.y, _mpTmpVec3A);
    convertTo3DCoordinateTo(rightScreen.x, rightScreen.y, _mpTmpVec3B);

    // 计算脸部宽度
    const faceWidth = _mpTmpVec3A.distanceTo(_mpTmpVec3B);

    // 合法值返回宽度，否则返回 -1
    return Number.isFinite(faceWidth) && faceWidth > 0 ? faceWidth : -1;
  }

  _updateHeadOccluderTransform(occluderMesh, occluderConfig, headYaw, faceWidth, faceScale) {
    if (!occluderMesh || !occluderConfig) {
      return;
    }

    var baseDiameter = 2 * (void 0 !== occluderConfig.baseRadius ? occluderConfig.baseRadius : 0.1);

    if (faceWidth > 0 && faceScale > 0 && baseDiameter > 0) {
      var scaleRatio = faceWidth / (baseDiameter * faceScale);
      var minScale = DivWidth > DivHeight ? occluderConfig.faceScaleMinLandscape : occluderConfig.faceScaleMinPortrait;
      var maxScale = occluderConfig.faceScaleMax;
      scaleRatio = Math.max(minScale, Math.min(maxScale, scaleRatio));

      var zScale = occluderConfig.zScale;
      occluderMesh.scale.set(scaleRatio, scaleRatio * zScale, scaleRatio);
    } else {
      var headDistance = this.checkHeadDistance ? this.checkHeadDistance() : 0.5;
      var yScaleMult = mapRange(headDistance, 0.3, 0.8, 1, 1.2);

      Number.isFinite(yScaleMult) &&
        occluderMesh.scale.set(occluderConfig.fallbackScaleXZ, yScaleMult * occluderConfig.fallbackScaleY, occluderConfig.fallbackScaleXZ);
    }

    // 恢复基础位置
    occluderMesh.userData && occluderMesh.userData.basePos && occluderMesh.position.copy(occluderMesh.userData.basePos);

    var yawAbs = Math.abs(headYaw);
    var shrinkStart = occluderConfig.shrinkStart;
    var shrinkEnd = occluderConfig.shrinkEnd;

    // 头部偏转过大时收缩遮罩
    if (yawAbs > shrinkStart) {
      var shrinkProgress = Math.min(1, (yawAbs - shrinkStart) / (shrinkEnd - shrinkStart));
      var shrinkScale = 1 - shrinkProgress * (1 - occluderConfig.minScale);

      occluderMesh.scale.x *= shrinkScale;
      occluderMesh.scale.z *= shrinkScale;

      var maxOffset = DivWidth > DivHeight ? occluderConfig.maxXOffsetLandscape : occluderConfig.maxXOffsetPortrait;
      var sideSign = headYaw >= 0 ? -1 : 1;
      occluderMesh.position.x += sideSign * maxOffset * shrinkProgress;
    }
  }

  /**
   * 创建Y轴渐变遮罩材质（用于headOccluder1）
   */
  _createHeadOccluderFadeMaterial(fadeTexture) {
    const fadeMat = new MeshBasicMaterial({
      colorWrite: false,
      side: DoubleSide,
      depthWrite: true,
      color: "#0000ff",
    });

    fadeMat.userData.shader = null;
    fadeMat.onBeforeCompile = (shader) => {
      fadeMat.userData.shader = shader;
      shader.uniforms.occlusionFadeTexture = { value: fadeTexture };
      shader.uniforms.occlusionFadeStartY = { value: this.headOccluderFadeStartY };
      shader.uniforms.occlusionFadeDistance = { value: this.headOccluderFadeDistance };

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n    varying vec3 vLocalPos;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n    vLocalPos = position;`);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\n    varying vec3 vLocalPos;\n    uniform sampler2D occlusionFadeTexture;\n    uniform float occlusionFadeStartY;\n    uniform float occlusionFadeDistance;\n    ${this._getBayerDitherShaderCode()}`,
        )
        .replace(
          "#include <alphatest_fragment>",
          `float fadeDistance = max(occlusionFadeDistance, 0.0001);\n    float fadeT = clamp((vLocalPos.y - occlusionFadeStartY) / fadeDistance, 0.0, 1.0);\n    float occlusionAlpha = texture2D(occlusionFadeTexture, vec2(1.0 - fadeT, 0.5)).a;\n    float ditherThreshold = getBayerDither4x4(gl_FragCoord.xy);\n    if (occlusionAlpha <= ditherThreshold) discard;\n    #include <alphatest_fragment>`,
        );
    };

    fadeMat.onBeforeRender = () => {
      if (fadeMat.userData.shader) {
        fadeMat.userData.shader.uniforms.occlusionFadeStartY.value = this.headOccluderFadeStartY;
        fadeMat.userData.shader.uniforms.occlusionFadeDistance.value = this.headOccluderFadeDistance;
      }
    };

    return fadeMat;
  }

  /**
   * 创建头部遮罩网格（主遮罩 + 渐变遮罩）
   */
  _createHeadOccluderMeshes() {
    const fadeTexture = this._getFrontOcclusionFadeTexture();

    // 主遮罩材质（纯深度写入）
    const basicMat = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide, depthWrite: true, color: "#ff0000" });
    const cylinderGeo1 = new CapsuleGeometry(0.1, 0.42, 8, 16);
    this.headOccluderMesh = new Mesh(cylinderGeo1, basicMat);
    this.headOccluderMesh.name = "headOccluder";
    this.headOccluderMesh.renderOrder = -Infinity;
    this.headOccluderMesh.castShadow = false;
    this.headOccluderMesh.receiveShadow = false;
    this.headOccluderMesh.position.set(0, 0, -0.15);
    this.headOccluderMesh.userData.basePos = this.headOccluderMesh.position.clone();
    this.headOccluderMesh.rotation.set(Math.PI / 2, 0, 0);
    this.headNode.add(this.headOccluderMesh);

    // 渐变遮罩材质（Y轴渐变 + 拜耳抖动）
    const fadeMat = this._createHeadOccluderFadeMaterial(fadeTexture);
    const cylinderGeo2 = new CapsuleGeometry(0.055, 0.42, 8, 16);
    this.headOccluderMesh1 = new Mesh(cylinderGeo2, fadeMat);
    this.headOccluderMesh1.name = "headOccluder1";
    this.headOccluderMesh1.renderOrder = -Infinity;
    this.headOccluderMesh1.castShadow = false;
    this.headOccluderMesh1.receiveShadow = false;
    this.headOccluderMesh1.position.set(0, 0, -0.082);
    this.headOccluderMesh1.userData.basePos = this.headOccluderMesh1.position.clone();
    this.headOccluderMesh1.rotation.set(Math.PI / 2, 0, 0);
    this.headNode.add(this.headOccluderMesh1);
  }

  updateHeadOccluder(isGlasses, faceLandmarks, yawRotation) {
    if (!this.headOccluderMesh) {
      this._createHeadOccluderMeshes();
    }

    // 重置遮罩状态
    if (this.headOccluderMesh) {
      this.headOccluderMesh.visible = true;
      this.headOccluderMesh.scale.set(1, 1, 1);
      this.headOccluderMesh1.visible = true;
      this.headOccluderMesh1.scale.set(1, 1, 1);
    }

    if (isGlasses && this.headOccluderMesh && this.headNode) {
      const faceWidth3D = this._getFaceWidth3D(faceLandmarks);
      const headScaleX = this.headNode.scale.x;
      const adjustedYaw = 1.12 * yawRotation;

      this._updateHeadOccluderTransform(this.headOccluderMesh, this.tryonConfig.headOccluder, adjustedYaw, faceWidth3D, headScaleX);
      if (this.headOccluderMesh1) {
        this._updateHeadOccluderTransform(this.headOccluderMesh1, this.tryonConfig.headOccluder1, adjustedYaw, faceWidth3D, headScaleX);
      }
    }

    if (isGlasses) {
      this._updateGlassOCVisible(yawRotation);
    }
  }

  /**
   * 创建拜耳抖动函数（字符串模板，供着色器使用）
   * 4x4 拜耳抖动函数：生成有序抖动阈值，实现平滑的透明度渐变效果
   */
  _getBayerDitherShaderCode = () => `
            float getBayerDither4x4(vec2 fragCoord) {
                vec2 cell = mod(fragCoord, 4.0);
                if (cell.y < 1.0) {
                    if (cell.x < 1.0) return 0.0 / 16.0;
                    if (cell.x < 2.0) return 8.0 / 16.0;
                    if (cell.x < 3.0) return 2.0 / 16.0;
                    return 10.0 / 16.0;
                }
                if (cell.y < 2.0) {
                    if (cell.x < 1.0) return 12.0 / 16.0;
                    if (cell.x < 2.0) return 4.0 / 16.0;
                    if (cell.x < 3.0) return 14.0 / 16.0;
                    return 6.0 / 16.0;
                }
                if (cell.y < 3.0) {
                    if (cell.x < 1.0) return 3.0 / 16.0;
                    if (cell.x < 2.0) return 11.0 / 16.0;
                    if (cell.x < 3.0) return 1.0 / 16.0;
                    return 9.0 / 16.0;
                }
                if (cell.x < 1.0) return 15.0 / 16.0;
                if (cell.x < 2.0) return 7.0 / 16.0;
                if (cell.x < 3.0) return 13.0 / 16.0;
                return 5.0 / 16.0;
            }
          `;

  /**
   * 创建Z轴渐变遮挡材质（根据模型Z坐标做透明度渐变）
   */
  _createZAxisOcclusionMaterial(occlusionFadeTexture) {
    const material = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide, depthWrite: true });
    material.userData.shader = null;

    material.onBeforeCompile = (shader) => {
      material.userData.shader = shader;
      shader.uniforms.occlusionFadeTexture = { value: occlusionFadeTexture };
      shader.uniforms.occlusionFadeStartZ = { value: this.frontOcclusionFadeStartZ };
      shader.uniforms.occlusionFadeDistance = { value: this.frontOcclusionFadeDistance };

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n    varying vec3 vLocalPos;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n    vLocalPos = position;`);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\n    varying vec3 vLocalPos;\n    uniform sampler2D occlusionFadeTexture;\n    uniform float occlusionFadeStartZ;\n    uniform float occlusionFadeDistance;\n    ${this._getBayerDitherShaderCode()}`,
        )
        .replace(
          "#include <alphatest_fragment>",
          `float fadeDistance = max(occlusionFadeDistance, 0.0001);\n    float fadeT = clamp((vLocalPos.z - occlusionFadeStartZ) / fadeDistance, 0.0, 1.0);\n    float occlusionAlpha = texture2D(occlusionFadeTexture, vec2(1.0 - fadeT, 0.5)).a;\n    float ditherThreshold = getBayerDither4x4(gl_FragCoord.xy);\n    if (occlusionAlpha <= ditherThreshold) discard;\n    #include <alphatest_fragment>`,
        );
    };

    material.onBeforeRender = () => {
      if (material.userData.shader) {
        material.userData.shader.uniforms.occlusionFadeStartZ.value = this.frontOcclusionFadeStartZ;
        material.userData.shader.uniforms.occlusionFadeDistance.value = this.frontOcclusionFadeDistance;
      }
    };

    return material;
  }

  /**
   * 创建Y轴顶部渐变遮挡材质（根据模型Y坐标做顶部渐变）
   */
  _createYAxisOcclusionMaterial(occlusionFadeTexture) {
    const material = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide, depthWrite: true });
    material.userData.shader = null;

    material.onBeforeCompile = (shader) => {
      material.userData.shader = shader;
      shader.uniforms.occlusionFadeTexture = { value: occlusionFadeTexture };
      shader.uniforms.occlusionTopFadeStartY = { value: this.frontOcclusionTopFadeStartY };
      shader.uniforms.occlusionTopFadeDistance = { value: this.frontOcclusionTopFadeDistance };

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n    varying vec3 vLocalPos;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\n    vLocalPos = position;`);

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\n    varying vec3 vLocalPos;\n    uniform sampler2D occlusionFadeTexture;\n    uniform float occlusionTopFadeStartY;\n    uniform float occlusionTopFadeDistance;\n    ${this._getBayerDitherShaderCode()}`,
        )
        .replace(
          "#include <alphatest_fragment>",
          `float topFadeDistance = max(occlusionTopFadeDistance, 0.0001);\n    float topFadeT = clamp((occlusionTopFadeStartY - vLocalPos.y) / topFadeDistance, 0.0, 1.0);\n    float occlusionAlpha = texture2D(occlusionFadeTexture, vec2(topFadeT, 0.5)).a;\n    float ditherThreshold = getBayerDither4x4(gl_FragCoord.xy);\n    if (occlusionAlpha <= ditherThreshold) discard;\n    #include <alphatest_fragment>`,
        );
    };

    material.onBeforeRender = () => {
      if (material.userData.shader) {
        material.userData.shader.uniforms.occlusionTopFadeStartY.value = this.frontOcclusionTopFadeStartY;
        material.userData.shader.uniforms.occlusionTopFadeDistance.value = this.frontOcclusionTopFadeDistance;
      }
    };

    return material;
  }

  /**
   * 初始化玻璃遮挡渐变网格（3层：Z渐变/Y渐变/实心）
   */
  initGlassOCMesh() {
    if (this.rootNode.getObjectByName("glassOC")) {
      this.glassOCMesh.visible = true;
      return;
    }

    this.glassOCMesh = new Object3D();
    this.glassOCMesh.name = "glassOC";

    const occlusionFadeTexture = this._getFrontOcclusionFadeTexture();
    const occlusionBoxGeometry = new BoxGeometry(0.3, 0.1, 0.2);

    // 创建3层遮挡材质
    const frontZOcclusionMaterial = this._createZAxisOcclusionMaterial(occlusionFadeTexture);
    const frontYOcclusionMaterial = this._createYAxisOcclusionMaterial(occlusionFadeTexture);
    const solidOcclusionMaterial = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide, depthWrite: true });

    // 创建网格
    const frontZOcclusionMesh = new Mesh(occlusionBoxGeometry, frontZOcclusionMaterial);
    const frontYOcclusionMesh = new Mesh(occlusionBoxGeometry, frontYOcclusionMaterial);
    const solidOcclusionMesh = new Mesh(occlusionBoxGeometry, solidOcclusionMaterial);

    // 旋转（贴合玻璃表面角度）
    frontZOcclusionMesh.rotation.set(Math.PI / 2, 0, 0);
    frontYOcclusionMesh.rotation.set(Math.PI / 2 + 0.3, 0, 0);
    solidOcclusionMesh.rotation.set(Math.PI / 2 - 0.4, 0, 0);

    // 阴影与渲染顺序
    [frontZOcclusionMesh, frontYOcclusionMesh, solidOcclusionMesh].forEach((mesh) => {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = -Infinity;
    });

    frontZOcclusionMesh.material.needsUpdate = true;
    frontYOcclusionMesh.material.needsUpdate = true;

    // 位置（错开形成多层遮挡）
    frontZOcclusionMesh.position.set(0, 0, 0);
    frontYOcclusionMesh.position.set(0, 0.08, 0.025);
    solidOcclusionMesh.position.set(0, 0.11, -0.01);

    // 宽高自适应缩放：根据容器比例调整遮挡网格大小
    if (DivWidth > DivHeight) {
      frontZOcclusionMesh.scale.set(0.7, 0.68, 0.68);
    } else {
      frontZOcclusionMesh.scale.set(0.66, 0.66, 0.66);
    }
    // 另外两个网格保持与第一个缩放一致
    frontYOcclusionMesh.scale.copy(frontZOcclusionMesh.scale);
    solidOcclusionMesh.scale.copy(frontZOcclusionMesh.scale);

    // 挂载引用
    this.frontOCMesh = frontZOcclusionMesh;
    this.frontTopOCMesh = frontYOcclusionMesh;
    this.frontTopSolidOCMesh = solidOcclusionMesh;

    // 添加到场景
    this.glassOCMesh.add(frontZOcclusionMesh);
    this.glassOCMesh.add(frontYOcclusionMesh);
    this.glassOCMesh.add(solidOcclusionMesh);
    this.rootNode.add(this.glassOCMesh);
  }

  _updateGlassOCVisible(yawRotation) {
    // 眼镜模式：根据头部偏转角度，自动控制前遮挡面显隐

    // 配置：是否开启侧脸遮挡逻辑
    const occlusionConfig = this.tryonConfig?.frontOcclusionYawSwitch || null;
    const showThreshold = occlusionConfig?.showAt ?? 0.12; // 大于此值 → 显示遮挡
    const hideThreshold = occlusionConfig?.hideAt ?? 0.08; // 小于此值 → 隐藏遮挡

    const headYawAbs = Math.abs(yawRotation); // 头部左右偏转绝对值
    let isSideTurnMode = !!this._frontOcclusionSideTurnMode;

    // 核心逻辑：来回切换，防止抖动
    if (isSideTurnMode) {
      // 已开启遮挡：角度变小才关闭
      if (headYawAbs <= hideThreshold) isSideTurnMode = false;
    } else {
      // 未开启遮挡：角度变大才开启
      // 未开启遮挡：角度变大才开启
      if (headYawAbs >= showThreshold) isSideTurnMode = true;
    }

    // 保存状态
    this._frontOcclusionSideTurnMode = isSideTurnMode;

    // 控制遮挡模型显隐
    if (this.frontOCMesh) this.frontOCMesh.visible = isSideTurnMode;
    if (this.frontTopOCMesh) this.frontTopOCMesh.visible = isSideTurnMode;
  }

  /**
   * 初始化胶囊形深度遮罩
   */
  initMaskOCMesh() {
    // 如果遮罩已存在，直接显示并返回
    if (this.rootNode.getObjectByName("maskOC")) {
      this.maskOCMesh.visible = true;
      return;
    }

    // 创建深度遮罩材质：不输出颜色，只写入深度（隐形遮挡）
    const maskMaterial = new MeshBasicMaterial({
      colorWrite: false,
      side: DoubleSide,
    });

    // 创建胶囊几何体（用于遮挡人脸的形状）
    const capsuleGeometry = new CapsuleGeometry(0.104, 0.3);

    // 创建遮罩根容器
    this.maskOCMesh = new Object3D();
    this.maskOCMesh.name = "maskOC";

    // 创建遮挡网格
    const maskMesh = new Mesh(capsuleGeometry, maskMaterial);
    maskMesh.renderOrder = -Infinity;
    maskMesh.castShadow = false;
    maskMesh.receiveShadow = false;

    // 位置与旋转
    maskMesh.position.set(0, 0.1, -0.063);
    maskMesh.rotation.set(Math.PI / 2, 0, 0);

    // 特殊设备旋转修正
    if (!this.isRhino5) {
      maskMesh.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    }

    // 加入场景
    this.maskOCMesh.add(maskMesh);
    this.rootNode.add(this.maskOCMesh);
  }

  initHatOCMesh() {
    if (this.rootNode.getObjectByName("hatOC")) {
      this.hatOCMesh.visible = !0;

      return;
    }

    var hatMaterial = new MeshBasicMaterial({
      colorWrite: !1,
      side: 2,
    });
    var capsuleGeometry = new CapsuleGeometry(0.075, 0.03);
    this.hatOCMesh = new Object3D();
    this.hatOCMesh.name = "hatOC";
    var hatMesh = new Mesh(capsuleGeometry, hatMaterial);
    hatMesh.renderOrder = -1 / 0;
    hatMesh.castShadow = !1;
    hatMesh.receiveShadow = !1;
    hatMesh.position.set(0, 0, -0.063);
    hatMesh.rotation.set(Math.PI / 2, 0, 0);
    this.isRhino5 || hatMesh.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    this.hatOCMesh.add(hatMesh);
    this.rootNode.add(this.hatOCMesh);

    //
    this.ringOCMesh && (this.ringOCMesh.visible = !1);
    this.watchOCMesh && (this.watchOCMesh.visible = !1);
    this.braceletOCMesh && (this.braceletOCMesh.visible = !1);
    this.necklaceOCMesh && (this.necklaceOCMesh.visible = !1);
    this.glassOCMesh && (this.glassOCMesh.visible = !1);
    this.maskOCMesh && (this.maskOCMesh.visible = !1);
    this.shoeOCMesh && (this.shoeOCMesh.visible = !1);
  }
}
