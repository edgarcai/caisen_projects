# LayaAir 3.4.0 第三方运行库声明

本目录中的运行库与 source map 来自 Layabox 官方 `v3.4.0` 发布包，未修改文件内容。

- 引擎源码：https://github.com/layabox/LayaAir/tree/v3.4.0
- 官方发布：https://github.com/layabox/LayaAir/releases/tag/v3.4.0
- 发布包：`LayaAir_3.4.0_libs.zip`
- 发布包 SHA-256：`a21b787b7d5cea92013e8903be1fe766e0c25573f2ae67f3078dfe60f72cfed9`
- 许可证：MIT，完整文本见同目录 `LICENSE`

为控制 H5 首包体积，当前仅保留二维 WebGL 文字游戏所需模块：

| 文件 | 用途 | SHA-256 |
| --- | --- | --- |
| `laya.core.js` | LayaAir 核心、舞台、资源加载、Sprite、Text 与 Input | `48cfa976fd9cbc8b12c7456921d876a8cb7c5feff551e121bbd41e3b678bd01a` |
| `laya.webgl_2D.js` | WebGL 二维渲染后端 | `940a21887e5e4c769807345257091133a3788a1fedd15eed13bad27783f76ebe` |
| `laya.ui.js` | 经典 UI 组件，包含 TextInput 与 TextArea | `57fa63829941f517f1385c2d7f909185bdf5a06edaf7d0d68d141c2637548549` |

`types/LayaAir.d.ts` 同样来自上述发布包，SHA-256 为
`e74dd9e231bcdfe0d1214a75b34b99419d371d9ffa79e1e45d8591fd41986616`。
