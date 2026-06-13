import SwiftUI
import UIKit

enum CurbTheme {
    static let paper = Color(red: 0.949, green: 0.925, blue: 0.875)
    static let ink = Color(red: 0.090, green: 0.082, blue: 0.059)
    static let green = Color(red: 0.122, green: 0.620, blue: 0.353)
    static let amber = Color(red: 0.878, green: 0.635, blue: 0.118)
    static let red = Color(red: 0.753, green: 0.071, blue: 0.122)
    static let meter = Color(red: 0.114, green: 0.412, blue: 0.647)
    static let gray = Color(red: 0.447, green: 0.443, blue: 0.404)

    static let uiPaper = UIColor(red: 0.949, green: 0.925, blue: 0.875, alpha: 1)
    static let uiInk = UIColor(red: 0.090, green: 0.082, blue: 0.059, alpha: 1)
    static let uiGreen = UIColor(red: 0.122, green: 0.620, blue: 0.353, alpha: 1)
    static let uiAmber = UIColor(red: 0.878, green: 0.635, blue: 0.118, alpha: 1)
    static let uiRed = UIColor(red: 0.753, green: 0.071, blue: 0.122, alpha: 1)
    static let uiMeter = UIColor(red: 0.114, green: 0.412, blue: 0.647, alpha: 1)
    static let uiGray = UIColor(red: 0.447, green: 0.443, blue: 0.404, alpha: 1)
}

enum CurbStatus: Equatable {
    case sweepingNow
    case soon
    case clear
    case postedSign

    var rank: Int {
        switch self {
        case .sweepingNow: 5
        case .soon: 4
        case .clear: 2
        case .postedSign: 1
        }
    }

    var color: Color {
        switch self {
        case .sweepingNow: CurbTheme.red
        case .soon: CurbTheme.amber
        case .clear: CurbTheme.green
        case .postedSign: CurbTheme.gray
        }
    }

    var uiColor: UIColor {
        switch self {
        case .sweepingNow: CurbTheme.uiRed
        case .soon: CurbTheme.uiAmber
        case .clear: CurbTheme.uiGreen
        case .postedSign: CurbTheme.uiGray
        }
    }
}

extension View {
    func signageButtonStyle(background: Color = CurbTheme.ink, foreground: Color = CurbTheme.paper) -> some View {
        self
            .font(.system(size: 15, weight: .800, design: .rounded))
            .foregroundStyle(foreground)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(CurbTheme.ink.opacity(0.95), lineWidth: 1.5)
            )
    }
}
