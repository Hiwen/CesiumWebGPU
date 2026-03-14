# Cesium WebGPU 完整改造提示词

## 项目目标
将Cesium从WebGL完全迁移到WebGPU，保持API兼容性，同时利用WebGPU的性能优势。

## 核心原则
1. **API兼容性优先**：保留所有公开API不变，用户代码无需修改
2. **性能优先**：充分利用WebGPU特性提升渲染效率
3. **渐进式迁移**：先实现基础功能，再逐步优化

## 一、架构改造

### 1.1 渲染引擎替换
- 用WebGPU API完全替换WebGL API
- 创建WebGPU渲染上下文，移除WebGL上下文
- 保持现有的渲染管线接口不变

### 1.2 核心API保留
以下API必须保持完全兼容：
- `Cesium.Viewer` - 主视图控制器
- `Cesium.Scene` - 场景管理
- `Cesium.Globe` - 地球表面渲染
- `Cesium.Camera` - 相机控制
- `Cesium.Entity` - 实体渲染
- `Cesium.Primitive` - 自定义几何体
- `Cesium.DrawCommand` - 渲染命令（内部实现可调整）
- `Cesium.ComputeCommand` - 计算命令（内部实现可调整）

### 1.3 数据加载机制
保持以下加载机制不变：
- 3D Tiles 格式支持
- GLB/GLTF 模型加载
- 影像瓦片加载
- 数字高程模型(DEM)加载
- Entity数据加载

## 二、着色器迁移

### 2.1 GLSL到WGSL转换
- 所有顶点着色器、片段着色器、计算着色器转换为WGSL
- 保持着色器接口一致（uniform、attribute、varying → binding）
- 使用WebGPU的绑定组机制替代uniform buffer

### 2.2 着色器特性映射
| WebGL特性 | WebGPU实现 |
|-----------|-----------|
| uniform | Uniform binding in bind group |
| attribute | Vertex buffer layout |
| varying | Interpolation in pipeline |
| texture sampler | Texture + sampler binding |
| transform feedback | Storage buffer + compute shader |

### 2.3 着色器优化
- 利用WebGPU的多线程编译优势
- 使用WebGPU的着色器反射获取绑定信息
- 实现着色器变体的编译时优化

## 三、渲染管线优化

### 3.1 基础管线
- 创建WebGPU渲染管线时启用深度测试、混合模式等
- 使用顶点缓冲区布局定义顶点属性
- 实现管线状态对象的缓存复用

### 3.2 绑定组管理
- 实现绑定组池化，减少绑定组创建开销
- 使用绑定组层级（view scene、draw command级别）
- 实现uniform buffer的动态偏移

### 3.3 命令编码
- 使用命令编码器进行批量渲染
- 实现命令列表的复用
- 利用WebGPU的并行编码能力

## 四、延迟渲染（可选高级特性）

### 4.1 GBuffer渲染
- 第一阶段：渲染几何信息到GBuffer（位置、法线、颜色、粗糙度等）
- 第二阶段：基于GBuffer进行光照计算

### 4.2 光照处理
- 使用计算着色器进行光照计算
- 支持大量灯光的高效渲染
- 实现光照聚类(Clustered Lighting)

### 4.3 后处理
- 利用WebGPU的并行计算进行后处理
- 实现TAA、Bloom、SSR等效果

## 五、性能优化

### 5.1 内存管理
- 实现GPU内存池管理
- 使用映射缓冲区(Mapped At Creation)优化上传
- 实现资源的引用计数和自动释放

### 5.2 渲染优化
- 实现视锥体剔除和遮挡剔除
- 使用多视口渲染
- 实现 LOD (Level of Detail) 优化

### 5.3 多线程
- 利用WebGPU的并行编码能力
- 实现预提交线程
- 使用计算着色器进行数据预处理

## 六、兼容性策略

### 6.1 渐进式迁移
- 第一阶段：基础3D渲染（ Globe、Entity、Primitive）
- 第二阶段：高级特性（3D Tiles、模型、特效）
- 第三阶段：性能优化（延迟渲染、聚类光照）

### 6.2 特性降级
- 检测WebGPU支持，不支持时提示用户，不做webgl兼容

## 七、测试策略

### 7.1 功能测试
- 确保所有现有Cesium示例正常运行
- 验证API行为完全一致
- 测试边缘情况和错误处理

### 7.2 性能测试
- 对比WebGL和WebGPU的渲染性能
- 测试大量实体、灯光、复杂模型的性能
- 监控GPU内存使用

## 八、开发规范

### 8.1 代码组织

根据现有的仓库结构，自行组织

### 8.2 命名规范
- WebGPU相关类使用WebGPU前缀
- 着色器文件使用.wgsl扩展名
- 绑定组命名遵循统一规范

### 8.3 错误处理
- 统一的WebGPU错误处理机制
- 详细的错误日志和调试信息
- 资源泄漏检测

## 九、参考资源

### WebGPU文档
- [WebGPU Specification](https://gpuweb.github.io/gpuweb/)
- [WebGPU Shader Language (WGSL)](https://gpuweb.github.io/gpuweb/wgsl/)
- [WebGPU Samples](https://github.com/webgpu/webgpu-samples)

### Cesium源码参考

- [Cesium Source Code](https://github.com/CesiumGS/cesium)
- WebGL渲染器实现
- 着色器源码
- 命令系统

### 引擎实现参考
- Chrome的WebGPU实现
- Dawn (WebGPU C++实现)
- 其他WebGPU引擎（如Ruffle）

## 十、里程碑计划

### Phase 1: 基础渲染 
- [ ] WebGPU上下文创建
- [ ] 基础着色器编译系统
- [ ] Entity渲染
- [ ] Globe渲染

### Phase 2: 高级特性 
- [ ] 3D Tiles支持
- [ ] GLB/GLTF模型
- [ ] 影像和DEM
- [ ] 相机控制

### Phase 3: 性能优化 
- [ ] 延迟渲染
- [ ] 光照优化
- [ ] 内存优化
- [ ] 多线程

### Phase 4: 稳定和测试
- [ ] 功能完整测试
- [ ] 性能基准测试
- [ ] 文档完善
- [ ] 示例代码