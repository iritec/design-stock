import Foundation
import Vision

#if canImport(FoundationModels)
import FoundationModels
#endif

private struct VisionAnalysis {
    let labels: [String]
    let text: String
}

@main
struct Tagger {
    static func main() async {
        do {
            let imageURL = try imageURLFromArguments()
            let analysis = try analyze(imageURL)

            #if canImport(FoundationModels)
            if #available(macOS 26.0, *),
               SystemLanguageModel.default.availability == .available,
               let tags = await appleIntelligenceTags(from: analysis) {
                try printResult(tags: tags, engine: "apple-intelligence")
                return
            }
            #endif

            try printResult(
                tags: Array(analysis.labels.prefix(3)),
                engine: "vision-fallback"
            )
        } catch {
            writeError(error.localizedDescription)
            Foundation.exit(EXIT_FAILURE)
        }
    }

    private static func imageURLFromArguments() throws -> URL {
        guard CommandLine.arguments.count == 2 else {
            throw TaggerError.invalidArguments("usage: tagger <absolute-image-path>")
        }

        let path = CommandLine.arguments[1]
        guard path.hasPrefix("/") else {
            throw TaggerError.invalidArguments("image path must be absolute")
        }
        guard FileManager.default.fileExists(atPath: path) else {
            throw TaggerError.invalidArguments("image file does not exist: \(path)")
        }
        return URL(fileURLWithPath: path)
    }

    private static func analyze(_ imageURL: URL) throws -> VisionAnalysis {
        let classifyRequest = VNClassifyImageRequest()
        let textRequest = VNRecognizeTextRequest()
        textRequest.recognitionLevel = .fast
        textRequest.recognitionLanguages = ["ja-JP", "en-US"]

        var classificationError: Error?
        do {
            try VNImageRequestHandler(url: imageURL, options: [:]).perform([classifyRequest])
        } catch {
            classificationError = error
        }

        var textError: Error?
        do {
            try VNImageRequestHandler(url: imageURL, options: [:]).perform([textRequest])
        } catch {
            textError = error
        }

        if let classificationError, let textError {
            throw TaggerError.visionAnalysisFailed(
                "classification: \(classificationError.localizedDescription); "
                    + "text recognition: \(textError.localizedDescription)"
            )
        }

        let labels = (classifyRequest.results ?? [])
            .filter { $0.confidence >= 0.2 }
            .sorted { $0.confidence > $1.confidence }
            .prefix(8)
            .map { $0.identifier.replacingOccurrences(of: "_", with: " ") }

        let recognizedText = (textRequest.results ?? [])
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: " ")

        return VisionAnalysis(
            labels: labels,
            text: String(recognizedText.prefix(300))
        )
    }

    #if canImport(FoundationModels)
    @available(macOS 26.0, *)
    private static func appleIntelligenceTags(from analysis: VisionAnalysis) async -> [String]? {
        let labels = analysis.labels.joined(separator: ", ")
        let prompt = """
        次の画像解析結果から、デザインまたはスクリーンショットの内容を表す短い日本語タグを1〜3個作成してください。
        例: ダッシュボード, LP, ダークUI, 料金表, モバイルアプリ
        Visionラベル: \(labels.isEmpty ? "なし" : labels)
        OCRテキスト: \(analysis.text.isEmpty ? "なし" : analysis.text)
        JSON文字列配列のみを出力してください。説明やMarkdownは不要です。
        """

        do {
            let response = try await LanguageModelSession().respond(to: prompt)
            return parseAndSanitizeTags(response.content)
        } catch {
            return nil
        }
    }
    #endif

    private static func parseAndSanitizeTags(_ response: String) -> [String]? {
        guard let openingBracket = response.firstIndex(of: "["),
              let closingBracket = response.lastIndex(of: "]"),
              openingBracket <= closingBracket else {
            return nil
        }

        let json = String(response[openingBracket...closingBracket])
        guard let data = json.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([String].self, from: data) else {
            return nil
        }

        var tags: [String] = []
        for rawTag in decoded {
            let trimmed = rawTag.trimmingCharacters(in: .whitespacesAndNewlines)
            let tag = String(trimmed.prefix(20))
            guard !tag.isEmpty, !tags.contains(tag) else {
                continue
            }
            tags.append(tag)
            if tags.count == 3 {
                break
            }
        }
        return tags.isEmpty ? nil : tags
    }

    private static func printResult(tags: [String], engine: String) throws {
        let object: [String: Any] = ["tags": tags, "engine": engine]
        let data = try JSONSerialization.data(withJSONObject: object)
        guard let json = String(data: data, encoding: .utf8) else {
            throw TaggerError.encodingFailed
        }
        print(json)
    }

    private static func writeError(_ message: String) {
        let line = "tagger: \(message)\n"
        FileHandle.standardError.write(Data(line.utf8))
    }
}

private enum TaggerError: LocalizedError {
    case invalidArguments(String)
    case visionAnalysisFailed(String)
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .invalidArguments(let message):
            return message
        case .visionAnalysisFailed(let message):
            return "Vision analysis failed: \(message)"
        case .encodingFailed:
            return "failed to encode JSON output"
        }
    }
}
