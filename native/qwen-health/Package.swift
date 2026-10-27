// swift-tools-version: 6.1
import PackageDescription
let package = Package(
    name: "VantiloQwenHealth",
    platforms: [.macOS(.v15)],
    products: [.executable(name: "vantilo-qwen-health", targets: ["VantiloQwenHealth"])],
    dependencies: [
        .package(url:"https://github.com/ml-explore/mlx-swift-lm", exact:"3.32.3"),
        .package(url:"https://github.com/huggingface/swift-huggingface", from:"0.9.0"),
        .package(url:"https://github.com/huggingface/swift-transformers", from:"1.3.0")
    ],
    targets: [
        .executableTarget(name:"VantiloQwenHealth",
          dependencies:[
            .product(name:"MLXLLM",package:"mlx-swift-lm"),
            .product(name:"MLXLMCommon",package:"mlx-swift-lm"),
            .product(name:"MLXHuggingFace",package:"mlx-swift-lm"),
            .product(name:"HuggingFace",package:"swift-huggingface"),
            .product(name:"Tokenizers",package:"swift-transformers")
          ],
          path:"Sources/VantiloQwenHealth")
    ]
)
