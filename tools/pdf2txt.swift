// Usage: swift tools/pdf2txt.swift <input.pdf> <output.txt> [firstPage] [lastPage]
// Dumps PDF text with "===== PDF PAGE n =====" markers using macOS PDFKit (no dependencies).
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("usage: swift pdf2txt.swift <input.pdf> <output.txt> [firstPage] [lastPage]\n".data(using: .utf8)!)
  exit(1)
}
let first = args.count > 3 ? max(1, Int(args[3]) ?? 1) : 1
let last = args.count > 4 ? min(doc.pageCount, Int(args[4]) ?? doc.pageCount) : doc.pageCount
var out = ""
if first <= last {
  for i in (first - 1)..<last {
    out += "\n\n===== PDF PAGE \(i + 1) =====\n"
    out += doc.page(at: i)?.string ?? ""
  }
}
try! out.write(toFile: args[2], atomically: true, encoding: .utf8)
print("wrote pages \(first)-\(last) of \(doc.pageCount) to \(args[2])")
