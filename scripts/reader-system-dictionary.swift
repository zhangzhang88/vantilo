// macOS Dictionary Services, not an AI model. Built as a tiny executable once
// during Reader build; dictionary content remains owned by macOS.
import Foundation
import CoreServices

struct DefinitionReply: Encodable {
    let word: String
    let definition: String?
}

let word = CommandLine.arguments.dropFirst().first ?? ""
guard word.utf8.count > 0, word.utf8.count <= 120,
      word.range(of: #"^[A-Za-z]+(?:[-'][A-Za-z]+)*$"#, options: .regularExpression) != nil else {
    fputs("Invalid word\n", stderr)
    exit(2)
}

// On a fresh helper process the first Dictionary Services call may only
// initialise the system dictionary index. A harmless warmup avoids an
// occasional empty first actual lookup.
func definition(for term: String) -> String? {
    let value = term as CFString
    guard let result = DCSCopyTextDefinition(nil, value,
                                             CFRange(location: 0, length: CFStringGetLength(value))) else {
        return nil
    }
    return result.takeRetainedValue() as String
}
_ = definition(for: "hello")
let raw = definition(for: word)
let trimmed = raw.map { String($0.prefix(8000)) }
let json = try JSONEncoder().encode(DefinitionReply(word: word, definition: trimmed))
FileHandle.standardOutput.write(json)
