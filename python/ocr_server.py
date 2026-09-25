"""OCR service. Run separately from Node: python python/ocr_server.py"""
import base64
import json
import os
import re
import statistics
import tempfile
import shutil
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pymupdf
import pytesseract
import requests
from dotenv import load_dotenv
from PIL import Image

# PDF_OCR_DPI = 300
# # A4 ở 400 DPI khoảng 33 triệu pixel; giữ đủ độ phân giải để nhận diện dấu chấm.
# MAX_OCR_PIXELS = 50_000_000
# # Cho phép mở file lớn để có thể thu nhỏ trước khi OCR; đầu vào do người dùng chọn.
# Image.MAX_IMAGE_PIXELS = 300_000_000

PDF_OCR_DPI = 200
# Cho phép mở ảnh đầu vào lớn để có thể thu nhỏ trước khi OCR.
# Ảnh vẫn bị giới hạn kích thước OCR thực tế bởi MAX_OCR_PIXELS.
MAX_OCR_PIXELS = 8_000_000
Image.MAX_IMAGE_PIXELS = 100_000_000

load_dotenv()
OPENROUTER_KEYS = [
    os.getenv("open_router_key1", "").strip(),
    os.getenv("open_router_key2", "").strip(),
]
# Giữ tương thích khi chạy local với cấu hình cũ chỉ có một key.
if not any(OPENROUTER_KEYS):
    OPENROUTER_KEYS = [os.getenv("open_router_key", "").strip()]
OPENROUTER_KEY_INDEX = 0
APPSCRIPT_URL = os.getenv("appscript_key", "").strip()
OPENROUTER_MODEL_OCR = os.getenv(
    "OPENROUTER_MODEL_OCR",
    os.getenv("open_router_model_ocr", "openai/gpt-4o-mini"),
).strip()
TESSERACT_CANDIDATES = [os.getenv("tesseract_cmd", ""), shutil.which("tesseract") or "", r"C:\Program Files\Tesseract-OCR\tesseract.exe", r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"]
for tesseract_path in TESSERACT_CANDIDATES:
    if tesseract_path and Path(tesseract_path).exists():
        pytesseract.pytesseract.tesseract_cmd = tesseract_path
        break

SHEET_NAME = "TEST"
OCR_CONFIDENCE_WARNING = 60
AI_CONFIDENCE_WARNING = 75
PI_CURRENCY = "USD"


class OpenRouterError(RuntimeError):
    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code


def check_openrouter_key(index, key):
    if not key:
        return f"key{index}: missing"
    try:
        response = requests.get(
            "https://openrouter.ai/api/v1/key",
            headers={"Authorization": f"Bearer {key}"},
            timeout=5,
        )
        return (
            f"key{index}: ok" if response.ok
            else f"key{index}: fail HTTP {response.status_code}"
        )
    except requests.RequestException as error:
        return f"key{index}: fail {error}"


def check_openrouter_keys():
    with ThreadPoolExecutor(max_workers=len(OPENROUTER_KEYS)) as executor:
        results = list(executor.map(
            check_openrouter_key,
            range(1, len(OPENROUTER_KEYS) + 1),
            OPENROUTER_KEYS,
        ))
    return ("ok" if any(result.endswith(": ok") for result in results) else "fail", results)


DOCUMENTS = {
    "PI": ["Số HĐ", "Ngày HĐ PI","Nhà cung cấp","XUẤT XỨ"],
    "INV": ["INV","Ngày INV","Tên hàng","Item code","Giá tổng","Đơn giá",],
    "PKL": ["Số hộp", "Trọng lượng (NET)"],
    "Bill": ["BL NO.", "Số Container", "Hãng tàu", "Cảng đi", "Cảng đến", "ETD"],
}
SHEET_FIELDS = tuple(dict.fromkeys(field for fields in DOCUMENTS.values() for field in fields))
SHEET_COLUMN_BY_FIELD = {
    field: field
    for field in SHEET_FIELDS
}
# Giữ tương thích với tên cột hiện tại trên Google Sheet.
SHEET_COLUMN_BY_FIELD.update({
    "Trọng lượng (NET)": "Trọng lượng",
})

NCC_RECORDS = [
    {"id": "NCC001", "name": "REIXACH", "country": "Spain"},
    {"id": "NCC002", "name": "ELPOZO", "country": "Spain"},
    {"id": "NCC003", "name": "TONNIES", "country": "Germany"},
    {"id": "NCC004", "name": "SEARA", "country": "Netherlands"},
    {"id": "NCC005", "name": "DLA&Associates Inc", "country": "Canada"},
    {"id": "NCC006", "name": "Vetracom Limited", "country": "Hong Kong"},
    {"id": "NCC007", "name": "Patel", "country": "Spain"},
    {"id": "NCC008", "name": "FRIBIN", "country": "Spain"},
    {"id": "NCC009", "name": "RIVASAM", "country": "Spain"},
    {"id": "NCC010", "name": "CINCO VILLAS", "country": "Spain"},
    {"id": "NCC011", "name": "FRIVALL", "country": "Spain"},
]

CARRIER_NAMES = [
    {"name": "HAPAG-LLOYD", "aliases": ["happ", "hapag", "hapag lloyd", "hapag-lloyd"]},
    {"name": "MAERSK", "aliases": ["maersk", "a.p. moller", "apm"]},
    {"name": "MSC", "aliases": ["msc", "mediterranean shipping", "mediterranean shipping company", "mediterranean shipping company s.a."]},
    {"name": "CMA CGM", "aliases": ["cma", "cma cgm"]},
    {"name": "COSCO", "aliases": ["cosco", "cosco shipping"]},
    {"name": "HMM", "aliases": ["hmm", "hyundai merchant marine"]},
    {"name": "FESCO", "aliases": ["fesco"]},
    {"name": "YML", "aliases": ["yang ming", "yangming", "yml"]},
    {"name": "CK LINE", "aliases": ["ckline", "ck line", "ckl"]},
    {"name": "EVERGREEN", "aliases": ["evergreen", "evergreen marine", "ever", "emc", "shipmentlink"]},
    {"name": "ONE", "aliases": ["one", "one line", "one cargo"]},
    {"name": "OOCL", "aliases": ["oocl", "oocl shipping"]},
    {"name": "PIL", "aliases": ["pil", "pacific international lines"]},
    {"name": "SINOKOR", "aliases": ["sinokor", "sinokor shipping"]},
]

PRODUCT_ORIGIN_COUNTRIES = {
    "russia": "Russia",
    "russian federation": "Russia",
    "spain": "Spain",
    "germany": "Germany",
    "netherlands": "Netherlands",
    "canada": "Canada",
    "brazil": "Brazil",
    "united states": "United States",
    "usa": "United States",
    "china": "China",
    "hong kong": "Hong Kong",
    "vietnam": "Vietnam",
}

DOCUMENT_INSTRUCTIONS = {
"PI": """QUY TẮC CHO PI:
- Chỉ lấy 2 trường Số HĐ và Ngày HĐ PI, cùng Nhà cung cấp và XUẤT XỨ.
- Số HĐ là mã PI/đơn hàng theo các nhãn Order No., Order Number, REF, Reference, PI No. hoặc PO No.
- Ngày HĐ PI là ngày của Proforma Invoice; không lấy ngày giao hàng, ngày sản xuất hoặc ngày khác.
- Nhà cung cấp là bên bán/phát hành PI trực tiếp cho công ty, không lấy nhà sản xuất/NCC nguồn trong mô tả hàng.
- Nếu nhà cung cấp thuộc danh sách NCC cấu hình thì chuẩn hóa về tên NCC trong danh sách.
- XUẤT XỨ là xuất xứ hàng hóa; ưu tiên Country of Origin, Product Origin, Origin hoặc vùng mô tả hàng.
- Không tự tạo hoặc suy đoán Số HĐ hay Ngày HĐ PI.
- Không trích xuất Tên hàng, Item code, Giá tổng hoặc Đơn giá trong PI.""",
   "INV": """QUY TẮC CHO INV:
- Đây là hóa đơn thương mại; phải đọc toàn bộ nội dung trước khi chọn dữ liệu.
- INV là Invoice Number/Invoice No. đúng ngữ cảnh, không nhầm với Customer Code, VAT/Tax Number, EAN, ORDER, PI hoặc mã tham chiếu.
- Nếu có ô INVOICE NUM và SPECIFICATION INVOICE, mã trong INVOICE NUM là INV.
- Ngày INV chỉ lấy từ DATE, Date of Invoice hoặc Invoice Date; không lấy PAYM DATE, Loading Date, Shipment Date, Delivery Date hoặc Due Date.
- Giữ nguyên mã INV, gồm số 0 đầu, dấu chấm, dấu gạch và dấu /.
- Tên hàng và Item code lấy theo từng mặt hàng; không tự tạo Item code.
- Giá tổng ưu tiên TOTAL, TOTAL AMOUNT hoặc GRAND TOTAL; Đơn giá lấy đúng Unit Price/Unit Cost/Price của từng mặt hàng.
- Nếu không tìm thấy trường nào thì trả chuỗi rỗng.""",
    "PKL": """QUY TẮC CHO PKL:
- PKL có nhiều dòng chi tiết theo từng thùng/lô nên bắt buộc đọc đúng tiêu đề và thứ tự cột.
- Số hộp hoặc số kiện là tổng BOXES, CARTONS hoặc CAJAS lưu ý không phải Paletts.
- Chỉ cần trả về số lượng kiện dạng số; không bắt buộc phải nhận diện hoặc trả về đơn vị kiện hàng (thùng, carton, box...).
- Trọng lượng (NET) là tổng NET WEIGHT, tức trọng lượng tịnh.
- Nếu có dòng TOTAL, lấy các giá trị trên dòng TOTAL rồi cộng lại toàn bộ dòng chi tiết để kiểm tra.
- Nếu không có TOTAL rõ ràng, được phép cộng tất cả dòng chi tiết hợp lệ và dùng kết quả tính được.
- Không cộng lặp header, subtotal, dòng TOTAL hoặc dòng bị lặp giữa các trang.
- Nếu tổng in sẵn khác tổng tính lại, chọn giá trị hợp lý nhất, giảm _confidence và ghi rõ chênh lệch trong _reason.
- Trong _reason phải nêu phép cộng hoặc ít nhất số lượng dòng đã cộng cho từng trường.""",
    "Bill": """QUY TẮC CHO BILL:
- Đây là tệp văn bản rõ ràng; ưu tiên đọc trực tiếp đúng nhãn và giá trị.
- BL NO. là mã của chính Bill of Lading/Sea Waybill, không phải booking hoặc customer reference.
- Số Container là mã container, thường gồm 4 chữ và 7 số.
- Hãng tàu là carrier/shipping line, không phải tên tàu/vessel.
- Hãng tàu bắt buộc chuẩn hóa về đúng một name trong danh sách công ty sử dụng: Hapag-Lloyd, Maersk, MSC, CMA CGM, COSCO, HMM, FESCO, Yang Ming, CKLINE, EVERGREEN, ONE, OOCL, PIL, SINOKOR.
- Ví dụ: Mediterranean Shipping Company S.A. hoặc Mediterranean Shipping Company phải trả đúng là MSC; Evergreen Marine phải trả EVERGREEN. Nếu không khớp danh sách trên thì để trống, không tự tạo tên viết tắt mới.
- Cảng đi lấy từ Port of Loading, POL hoặc Place of Receipt theo ngữ cảnh vận chuyển.
- Cảng đến lấy từ Port of Discharge, POD, Destination hoặc Place of Delivery theo ngữ cảnh vận chuyển.
- Không được lấy Cảng đi làm Cảng đến hoặc ngược lại.
- Không lấy Port of Loading, POL hoặc Place of Receipt làm Cảng đến.
- Cảng đến nếu thuộc khu vực Cat Lai/Hồ Chí Minh thì trả HCM; nếu là Hai Phong/Hải Phòng thì trả HP. Không trả tên cảng đầy đủ.
- ETD là ngày tàu khởi hành hoặc hàng bắt đầu hành trình; không lấy ETA, ngày đến, ngày phát hành hoặc ngày ký.
- Dùng tiêu đề chứng từ, đơn vị phát hành và ngữ cảnh trường để phân biệt các mã hoặc tên gần nhau.""",
}


NUMBER_FORMAT_INSTRUCTIONS = """QUY TẮC CHUẨN HÓA SỐ:

- Được phép sửa dấu phân cách số bị OCR sai dựa trên ngữ cảnh và phép kiểm tra tổng.

- Dùng format số quốc tế:
  + Dấu phẩy (,) để phân tách hàng nghìn.
  + Dấu chấm (.) để phân tách phần thập phân.

- Số hộp trả về dạng số nguyên, không có dấu phân cách hàng nghìn.
  Ví dụ: 8719, 9181233.

- NET trả về 2 chữ số thập phân và có dấu phẩy phân tách hàng nghìn.
  Ví dụ:
  25920 → 25,920.00
  25920.5 → 25,920.50
  762719.22 → 762,719.22

- Giá tổng trả về theo dạng "số LOẠI_TIỀN", có 2 chữ số thập phân và có dấu phẩy phân tách hàng nghìn.
  Ví dụ:
  25920.5 USD → 25,920.50 USD
  989121.87 USD → 989,121.87 USD

- Lấy đúng loại tiền gắn với giá tổng trong chứng từ.

- Nếu chứng từ chỉ có ký hiệu tiền tệ, giữ đúng ký hiệu đó khi không đủ căn cứ xác định mã tiền.

- Nếu không thấy loại tiền, không được tự đoán; trả số tiền và ghi rõ thiếu loại tiền trong _reason.""" 

MONTHS_EN = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10,
    "nov": 11, "dec": 12,
}


def ocr_languages():
    try:
        return "eng+vie" if "vie" in pytesseract.get_languages(config="") else "eng"
    except Exception:
        return "eng"


def normalize_date(value):
    """Convert common OCR/English date formats to DD/MM/YYYY."""
    value = str(value or "").strip()
    match = re.search(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", value)
    if match:
        year, month, day = match.groups()
        return f"{int(day):02d}/{int(month):02d}/{year}"
    match = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b", value)
    if match:
        day, month, year = match.groups()
        return f"{int(day):02d}/{int(month):02d}/{year}"
    month_pattern = "|".join(MONTHS_EN)
    match = re.search(rf"\b(\d{{1,2}})\s+({month_pattern})\s+(\d{{4}})\b", value, re.I)
    if match:
        day, month, year = match.groups()
        return f"{int(day):02d}/{MONTHS_EN[month.lower()]:02d}/{year}"
    # Hỗ trợ dạng thường gặp trong vận đơn: 15.MAY.2026, 15-MAY-2026.
    match = re.search(rf"\b(\d{{1,2}})\s*[-/.]\s*({month_pattern})\s*[-/.]\s*(\d{{4}})\b", value, re.I)
    if match:
        day, month, year = match.groups()
        return f"{int(day):02d}/{MONTHS_EN[month.lower()]:02d}/{year}"
    match = re.search(rf"\b({month_pattern})\s+(\d{{1,2}}),?\s+(\d{{4}})\b", value, re.I)
    if match:
        month, day, year = match.groups()
        return f"{int(day):02d}/{MONTHS_EN[month.lower()]:02d}/{year}"
    # Hỗ trợ cả MAY 21/2026, MAY-21-2026 và MAY/21/2026.
    match = re.search(rf"\b({month_pattern})\s*[-/.]\s*(\d{{1,2}})\s*[-/.]\s*(\d{{4}})\b", value, re.I)
    if match:
        month, day, year = match.groups()
        return f"{int(day):02d}/{MONTHS_EN[month.lower()]:02d}/{year}"
    # Một số OCR giữ khoảng trắng giữa tên tháng và ngày nhưng không có dấu phân cách.
    match = re.search(rf"\b({month_pattern})\s+(\d{{1,2}})[/-](\d{{4}})\b", value, re.I)
    if match:
        month, day, year = match.groups()
        return f"{int(day):02d}/{MONTHS_EN[month.lower()]:02d}/{year}"
    return value


def prepare_image(image):
    """Reduce oversized images before sending them to Tesseract."""                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             
    pixels = image.width * image.height
    if pixels > MAX_OCR_PIXELS:
        scale = (MAX_OCR_PIXELS / pixels) ** 0.5
        size = (max(1, int(image.width * scale)), max(1, int(image.height * scale)))
        image = image.resize(size, Image.Resampling.LANCZOS)

    return image


def ocr_image(image):
    data = pytesseract.image_to_data(
        image.convert("RGB"),
        lang=ocr_languages(),
        config="--psm 6",
        output_type=pytesseract.Output.DICT,
    )
    lines, confidences = {}, []
    for i, (word, value) in enumerate(zip(data["text"], data["conf"])):
        if word and word.strip():
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            line = lines.setdefault(
                key,
                {"words": [], "left": data["left"][i]},
            )
            line["words"].append(word.strip())
            try:
                if float(value) >= 0:
                    confidences.append(float(value))
            except (TypeError, ValueError):
                pass
    width = max(image.width, 1)
    rendered = []
    for line in lines.values():
        indent = " " * min(100, int(line["left"] / width * 100))
        rendered.append(indent + " ".join(line["words"]))
    return "\n".join(rendered), statistics.mean(confidences) if confidences else 0


def pdf_page_text_a4(page):
    """Render selectable PDF text using the original A4 coordinates."""
    page_width = max(page.rect.width, 1)
    words = page.get_text("words", sort=True)
    rows = []
    for word in words:
        if len(word) < 5 or not str(word[4]).strip():
            continue
        x0, y0, text = float(word[0]), float(word[1]), str(word[4])
        row = next((item for item in rows if abs(item["y"] - y0) <= 3), None)
        if row is None:
            row = {"y": y0, "words": []}
            rows.append(row)
        row["words"].append((x0, text))
    rows.sort(key=lambda item: item["y"])
    rendered = []
    previous_y = None
    for row in rows:
        if previous_y is not None:
            vertical_gap = round((row["y"] - previous_y) / 12) - 1
            rendered.extend([""] * min(5, max(0, vertical_gap)))
        line = [" "] * 120
        cursor = 0
        for x0, text in sorted(row["words"], key=lambda item: item[0]):
            position = min(110, max(0, round(x0 / page_width * 110)))
            if position <= cursor:
                position = cursor + 1
            for char in text:
                while position >= len(line):
                    line.append(" ")
                line[position] = char
                position += 1
            cursor = position
        rendered.append("".join(line).rstrip())
        previous_y = row["y"]
    return "\n".join(rendered).strip()


def ocr_file(file_path):
    path = Path(file_path)
    texts, confidences, used_ocr = [], [], False
    if path.suffix.lower() == ".pdf":
        with pymupdf.open(file_path) as pdf:
            for page in pdf:
                # sort=True sắp xếp theo vị trí trên trang thay vì thứ tự layer PDF.
                text = pdf_page_text_a4(page)
                if text:
                    texts.append(text)
                    confidences.append(100)
                else:
                    used_ocr = True
                    pixmap = page.get_pixmap(dpi=PDF_OCR_DPI, alpha=False)
                    image = Image.open(BytesIO(pixmap.tobytes("png")))
                    text, confidence = ocr_image(prepare_image(image))
                    texts.append(text)
                    confidences.append(confidence)
    else:
        used_ocr = True
        with Image.open(file_path) as image:
            text, confidence = ocr_image(prepare_image(image))
            texts.append(text)
            confidences.append(confidence)
    result = "\n\n--- TRANG/ẢNH TIẾP THEO ---\n\n".join(texts).strip()
    if not result:
        raise ValueError("Không đọc được nội dung từ file.")
    return result, statistics.mean(confidences), used_ocr


def extract_json(text, fields):
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I).strip()
    start = text.find("{")
    if start < 0:
        raise ValueError("AI không trả về JSON hợp lệ.")
    try:
        data, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError as error:
        raise ValueError(f"AI trả về JSON lỗi: {error}") from error
    result = {field: str(data.get(field, "") or "").strip() for field in fields}
    for field in result:
        if "Ngày" in field or field == "ETD":
            result[field] = normalize_date(result[field])
    try:
        result["_confidence"] = float(data.get("_confidence", 0) or 0)
    except (TypeError, ValueError):
        result["_confidence"] = 0
    result["_reason"] = str(data.get("_reason", "") or "").strip()
    return result


def extract_json(text, fields, as_array=False):
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I).strip()
    start = text.find("{")
    if start < 0:
        raise ValueError("AI khong tra ve JSON hop le.")
    try:
        data, _ = json.JSONDecoder().raw_decode(text[start:])
    except json.JSONDecodeError as error:
        raise ValueError(f"AI tra ve JSON loi: {error}") from error

    def clean_item(item):
        item = item if isinstance(item, dict) else {}
        cleaned = {field: str(item.get(field, "") or "").strip() for field in fields}
        for field in cleaned:
            if "Ngay" in field or field == "ETD":
                cleaned[field] = normalize_date(cleaned[field])
        return cleaned

    if as_array:
        items = data.get("items", data.get("data", [])) if isinstance(data, dict) else data
        if not isinstance(items, list):
            items = [items]
        result = [clean_item(item) for item in items if isinstance(item, dict)]
        return result or [clean_item({})]

    result = clean_item(data)
    try:
        result["_confidence"] = float(data.get("_confidence", 0) or 0)
    except (TypeError, ValueError):
        result["_confidence"] = 0
    result["_reason"] = str(data.get("_reason", "") or "").strip()
    return result


def call_openrouter(prompt):
    """Gọi model OCR duy nhất và yêu cầu phản hồi JSON."""
    global OPENROUTER_KEY_INDEX
    if not any(OPENROUTER_KEYS):
        raise OpenRouterError(500, "Thiếu open_router_key1 và open_router_key2")

    last_error = None
    key_count = len(OPENROUTER_KEYS)
    for offset in range(key_count):
        index = (OPENROUTER_KEY_INDEX + offset) % key_count
        key = OPENROUTER_KEYS[index]
        if not key:
            continue
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENROUTER_MODEL_OCR,
                "temperature": 0,
                "max_tokens": 2048,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=120,
        )
        if response.ok:
            OPENROUTER_KEY_INDEX = index
            return response.json()["choices"][0]["message"]["content"]

        last_error = OpenRouterError(
            response.status_code,
            f"OpenRouter key{index + 1} lỗi {response.status_code}: {response.text[:500]}"
        )
        if response.status_code not in {401, 402, 403, 429}:
            break

    raise last_error or OpenRouterError(500, "Không có OpenRouter key khả dụng")


def build_extraction_prompt(ocr_text, doc_type):
    """Tạo prompt tiếng Việt; chỉ PKL được phép tính tổng từ dòng chi tiết."""
    fields = DOCUMENTS[doc_type]
    output_shape = ""
    if doc_type in {"INV", "Bill"}:
        output_shape = """
QUY TẮC TRẢ VỀ DẠNG MẢNG:
- Luôn trả về JSON có key items là một mảng.
- Với INV, mỗi phần tử trong items là một mặt hàng riêng.
- Với Bill/BL, mỗi phần tử trong items là một container hoặc một dòng dữ liệu BL riêng.
- Nếu chỉ có một mặt hàng/container thì items vẫn là mảng có một phần tử.
- Nếu không có Item code thì trả chuỗi rỗng; không tự tạo hoặc suy đoán mã.
"""
    supplier_rule = ""
    carrier_rule = ""
    if doc_type == "Bill":
        carrier_rule = f"""
QUY TẮC CHUẨN HÓA HÃNG TÀU:
- Chỉ được trả về đúng trường name trong danh sách sau, không trả tên đầy đủ khác: {json.dumps(CARRIER_NAMES, ensure_ascii=False)}.
- Đối chiếu alias và ngữ cảnh toàn bộ chứng từ. Ví dụ Mediterranean Shipping Company S.A. → MSC.
- Nếu không khớp một hãng trong danh sách thì để trống Hãng tàu; không tự tạo mã hoặc tên viết tắt.
"""
    if False and doc_type == "PI":
        supplier_records = json.dumps(
            [
                {"name": record["name"], "country": record["country"]}
                for record in NCC_RECORDS
            ],
            ensure_ascii=False,
        )
        supplier_rule = f"""
QUY TẮC NHÀ CUNG CẤP:
- Danh sách NCC chuẩn và quốc gia cố định: {supplier_records}.
- Nếu đơn vị phát hành khớp một NCC trong danh sách (kể cả lỗi OCR nhẹ), trả đúng tên chuẩn và bắt buộc dùng country trong danh sách cho XUẤT XỨ.
- Ví dụ PATEL/PATEL S.A.U. luôn trả Nhà cung cấp là Patel và XUẤT XỨ là Spain.
- Chỉ áp dụng country cố định cho các NCC trong danh sách trên; không tự gán country của NCC này cho công ty khác.
- Nếu nhà cung cấp không thuộc danh sách, giữ nguyên bên bán trực tiếp/phát hành PI làm Nhà cung cấp.
- Với NCC ngoài danh sách, XUẤT XỨ là xuất xứ hàng hóa, không mặc định là quốc gia đăng ký hoặc địa chỉ của bên bán trung gian.
- Được suy luận XUẤT XỨ từ Product origin, Country of origin, mô tả hàng hoặc tên/quốc gia của nhà sản xuất hay NCC nguồn ở gần dòng hàng hóa.
- Ví dụ: Vetracom Limited phát hành PI và dòng hàng ghi "Corall Russia" thì Nhà cung cấp là "Vetracom Limited", XUẤT XỨ là "Russia"; Corall chỉ là NCC nguồn/nhà sản xuất, không thay thế Vetracom.
- Nếu không có căn cứ nào về xuất xứ hàng hóa trong OCR thì để trống XUẤT XỨ.
- Nêu trong _reason căn cứ xác định cả Nhà cung cấp trực tiếp và XUẤT XỨ hàng hóa.
"""

    return f"""Bạn là model duy nhất đọc và trích xuất chứng từ loại {doc_type}.
Toàn bộ chỉ dẫn và phần giải thích phải dùng tiếng Việt.

YÊU CẦU ĐẦU RA:
- Chỉ trả về một JSON object hợp lệ, không markdown và không thêm văn bản bên ngoài.
- Giữ nguyên chính xác các key nghiệp vụ: {json.dumps(fields, ensure_ascii=False)}.
- Không trích xuất hoặc trả về trường Xuất xứ nếu trường này không nằm trong danh sách key nghiệp vụ.
- Thêm _confidence từ 0 đến 100.
- Thêm _reason để giải thích ngắn gọn nguồn và cách xác định từng giá trị.
- Ngày được chuẩn hóa sang DD/MM/YYYY.
- Mã định danh phải giữ nguyên ký tự và số 0 ở đầu.

NGUYÊN TẮC CHUNG:
- Đọc toàn bộ nội dung trước khi chọn giá trị.
- OCR có thể đảo dòng, tách nhãn hoặc sai chính tả nhẹ; được phép suy luận lại quan hệ
  nhãn–giá trị bằng bố cục và ngữ cảnh.
- Không tự bịa mã, tên riêng hoặc ngày không có căn cứ trong tài liệu.
- Nếu có nhiều ứng viên, chọn ứng viên hợp lý nhất, giảm _confidence và ghi giả định
  trong _reason để người dùng kiểm tra.
- Được phép cộng, trừ, nhân, chia và đổi đơn vị cho mọi trường định lượng hoặc tiền tệ.
- Mọi số hạng dùng để tính phải có trong OCR; ghi phép tính và giả định trong _reason.
- Mã PI/INV/BL/container, mã đơn hàng, mã tham chiếu và ngày tháng không phải đại lượng;
  không được tính toán hoặc tự tạo các giá trị này.

{NUMBER_FORMAT_INSTRUCTIONS}

{output_shape}

    QUY TẮC RIÊNG CHO TIỀN:
    - Giá tổng và Đơn giá thuộc chứng từ INV.
    - Lấy đúng loại tiền được ghi trên INV.
    - Không tự quy đổi tiền tệ.
    - Nếu INV ghi USD thì trả USD.
    - Nếu INV ghi EUR thì trả EUR.
    - Nếu INV ghi VND/VNĐ thì trả VND/VNĐ.
    - Không tự mặc định tiền tệ nếu chứng từ không có căn cứ.

{supplier_rule}
{carrier_rule}
{DOCUMENT_INSTRUCTIONS[doc_type]}

NỘI DUNG OCR:

{ocr_text[:50000]}"""


def analyze_with_openrouter(ocr_text, doc_type):
    """Trích xuất kết quả cuối bằng đúng một model OpenRouter."""
    if not any(OPENROUTER_KEYS):
        raise ValueError("Thiếu open_router_key1 và open_router_key2 trong file .env")
    if doc_type not in DOCUMENTS:
        raise ValueError(f"Loại chứng từ không được hỗ trợ: {doc_type}")

    fields = DOCUMENTS[doc_type]
    model_result = extract_json(
        call_openrouter(build_extraction_prompt(ocr_text, doc_type)),
        fields,
    )
    result = dict(model_result)
    normalize_result_formats(result, doc_type, ocr_text)
    if doc_type == "INV":
        reconcile_invoice_number(result, ocr_text)
    if "Cảng đến" in result:
        original_port = result.get("Cảng đến", "")
        normalized_port = normalize_destination_port(original_port)
        if original_port and normalized_port != original_port:
            result["Cảng đến"] = normalized_port
            result["_reason"] = (
                f'{result.get("_reason", "").strip()} '
                f'Đã chuẩn hóa Cảng đến {original_port} thành {normalized_port}.'
            ).strip()
        elif original_port and not normalized_port:
            result["Cảng đến"] = ""
            result["_confidence"] = min(float(result.get("_confidence", 0) or 0), 60)
            result["_port_validation_warning"] = (
                f'Không nhận diện được Cảng đến chuẩn HCM/HP từ giá trị: {original_port}.'
            )
    result["_model_result"] = {
        **{field: result.get(field, "") for field in fields},
        "_confidence": result.get("_confidence", 0),
        "_reason": result.get("_reason", ""),
    }
    return result

def analyze_with_openrouter(ocr_text, doc_type):
    if not any(OPENROUTER_KEYS):
        raise ValueError("Thieu open_router_key1 va open_router_key2 trong file .env")
    if doc_type not in DOCUMENTS:
        raise ValueError(f"Loai chung tu khong duoc ho tro: {doc_type}")

    fields = DOCUMENTS[doc_type]
    model_result = extract_json(
        call_openrouter(build_extraction_prompt(ocr_text, doc_type)),
        fields,
        as_array=doc_type in {"INV", "Bill"},
    )

    if doc_type in {"INV", "Bill"}:
        results = []

        for item in model_result:
            normalize_result_formats(item, doc_type, ocr_text)
            results.append(item)

        return results

    result = dict(model_result)
    normalize_result_formats(result, doc_type, ocr_text)
    if doc_type == "INV":
        reconcile_invoice_number(result, ocr_text)
    if "Cảng đến" in result:
        original_port = result.get("Cảng đến", "")
        normalized_port = normalize_destination_port(original_port)
        if original_port and normalized_port != original_port:
            result["Cảng đến"] = normalized_port
        elif original_port and not normalized_port:
            result["Cảng đến"] = ""
            result["_confidence"] = min(float(result.get("_confidence", 0) or 0), 60)
            result["_port_validation_warning"] = (
                f"Khong nhan dien duoc Cang den chuan HCM/HP: {original_port}."
            )
    result["_model_result"] = {
        **{field: result.get(field, "") for field in fields},
        "_confidence": result.get("_confidence", 0),
        "_reason": result.get("_reason", ""),
    }
    return result


def normalize_for_match(value):
    """Chuẩn hóa chuỗi để đối chiếu tên nhà cung cấp."""
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    without_accents = "".join(
        character
        for character in normalized
        if not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]", "", without_accents.lower())


def normalize_destination_port(value):
    """Chỉ trả về mã tỉnh/thành mà hệ thống đang sử dụng cho cảng đến."""
    text = str(value or "").strip()
    compact = normalize_for_match(text)
    if not compact:
        return ""

    if any(alias in compact for alias in ("catlai", "hcmc", "hochiminh", "saigon")):
        return "HCM"
    if any(alias in compact for alias in ("haiphong", "haiphongport")):
        return "HP"

    # Không đưa tên cảng/tỉnh lạ vào dữ liệu chuẩn để tránh làm sai bộ lọc.
    return ""


def parse_decimal(value):
    """Đọc số theo cả định dạng 25.920,00 và 25,920.00."""
    text = re.sub(r"[^0-9,.-]", "", str(value or "").strip())
    if not text or not re.search(r"\d", text):
        return None

    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif text.count(",") > 1:
        parts = text.split(",")
        if all(len(part) == 3 for part in parts[1:]):
            text = "".join(parts)
        else:
            text = "".join(parts[:-1]) + "." + parts[-1]
    elif text.count(".") > 1:
        parts = text.split(".")
        if all(len(part) == 3 for part in parts[1:]):
            text = "".join(parts)
        else:
            text = "".join(parts[:-1]) + "." + parts[-1]
    elif "," in text:
        text = text.replace(",", ".")

    try:
        return Decimal(text)
    except InvalidOperation:
        return None

def format_number(
    value,
    decimal_places=None,
    integer=False,
    grouped_thousands=False,
    decimal_separator=".",
):
    """Chuẩn hóa số theo format:
    - Hàng nghìn: dấu ,
    - Hàng thập phân: dấu .
    - Số nguyên: không có dấu phân cách hàng nghìn.
    """

    raw_number = re.sub(r"[^0-9,.-]", "", str(value or "").strip())

    if not raw_number or not re.search(r"\d", raw_number):
        return str(value or "").strip()

    try:
        if "," in raw_number and "." in raw_number:
            last_comma = raw_number.rfind(",")
            last_dot = raw_number.rfind(".")

            if last_comma > last_dot:
                # 27.990,000
                normalized = raw_number.replace(".", "").replace(",", ".")
            else:
                # 762,719.22
                normalized = raw_number.replace(",", "")

        elif "," in raw_number:
            parts = raw_number.split(",")

            # 762,719 -> 762719
            # 2,799 -> 2799
            if len(parts) > 1 and all(len(part) == 3 for part in parts[1:]):
                normalized = "".join(parts)
            else:
                # 25920,5 -> 25920.5
                normalized = raw_number.replace(",", ".")

        elif "." in raw_number:
            parts = raw_number.split(".")

            # 27.990 -> 27990
            # 2.799 -> 2799
            if len(parts) > 1 and all(len(part) == 3 for part in parts[1:]):
                normalized = "".join(parts)
            else:
                # 25920.5 -> 25920.5
                normalized = raw_number

        else:
            normalized = raw_number

        number = Decimal(normalized)

    except (InvalidOperation, ValueError):
        return str(value or "").strip()
    if integer:
        return str(int(number))
    if decimal_places is not None:
        return f"{number:,.{decimal_places}f}"
    formatted = f"{number:,}"

    if decimal_separator != ".":
        formatted = formatted.replace(".", decimal_separator)

    return formatted


def explicit_currencies(text):
    """Trả về các mã tiền được viết rõ ràng trong văn bản."""
    upper_text = str(text or "").upper()
    currencies = set()
    if re.search(r"\b(?:USD|US\s*DOLLARS?)\b", upper_text) or "US$" in upper_text:
        currencies.add("USD")
    if re.search(r"\b(?:EUR|EUROS?)\b", upper_text) or "€" in upper_text:
        currencies.add("EUR")
    if re.search(r"\b(?:VND|VNĐ)\b", upper_text) or "₫" in upper_text:
        currencies.add("VND")
    return currencies


def detect_currency(value, ocr_text):
    """Lấy loại tiền mà không quy đổi giữa các đồng tiền."""
    value_currencies = explicit_currencies(value)
    if len(value_currencies) == 1:
        return next(iter(value_currencies))

    document_currencies = explicit_currencies(ocr_text)
    if len(document_currencies) == 1:
        return next(iter(document_currencies))

    value_text = str(value or "")
    if "$" in value_text:
        return "$"
    return ""


def normalize_money(value, ocr_text):
    """Chuẩn hóa số tiền và giữ nguyên loại tiền của chứng từ."""
    currency = PI_CURRENCY
    decimal_places = 2
    amount = format_number(
        value,
        decimal_places=decimal_places,
        grouped_thousands=True,
    )
    return f"{amount} {currency}".strip(), currency


def parse_calculation_number(value):
    """Đọc số dùng trong phép tính, coi nhóm 3 chữ số là dấu hàng nghìn."""
    raw_number = re.sub(r"[^0-9,.-]", "", str(value or "").strip())
    if re.fullmatch(r"-?\d{1,3}(?:[.,]\d{3})+", raw_number):
        return Decimal(raw_number.replace(".", "").replace(",", ""))
    return parse_decimal(raw_number)


def extract_pi_payment_total(ocr_text):
    """Cộng các đợt thanh toán PI khi tỷ lệ cộng đủ 100%."""
    payment_parts = []
    currency_pattern = r"(?:US\$|USD|EUR|EURO|VND|VNĐ|€|₫|\$)"
    for line in str(ocr_text or "").splitlines():
        percent_match = re.search(r"\b(\d{1,3})\s*%", line)
        amount_match = re.search(
            rf"{currency_pattern}\s*([0-9][0-9\s.,]*)",
            line,
            re.IGNORECASE,
        )
        if not percent_match or not amount_match:
            continue
        amount = parse_calculation_number(amount_match.group(1))
        currency = PI_CURRENCY
        if amount is not None and currency:
            payment_parts.append((int(percent_match.group(1)), amount, currency))

    if len(payment_parts) < 2:
        return None
    if sum(percent for percent, _, _ in payment_parts) != 100:
        return None
    total = sum((amount for _, amount, _ in payment_parts), Decimal("0"))
    return total, PI_CURRENCY, payment_parts


def extract_pi_quantity_price_total(ocr_text):
    """Tính tổng PI từ Quantity × Price khi đọc được đơn vị tương thích."""
    text = str(ocr_text or "")
    quantity_match = re.search(
        r"\bQUANTITY\s*:\s*([0-9][0-9\s.,]*)\s*(KGS?|KG|MTS?|MT)\b",
        text,
        re.IGNORECASE,
    )
    price_match = re.search(
        r"\bPRICE\s*:\s*((?:US\$|USD|EUR|EURO|VND|VNĐ|€|₫|\$)\s*)?"
        r"([0-9][0-9\s.,]*)\s*/\s*(KGS?|KG|MTS?|MT)\b",

        text,
        re.IGNORECASE,
    )
    if not quantity_match or not price_match:
        return None

    quantity = parse_calculation_number(quantity_match.group(1))
    unit_price = parse_calculation_number(price_match.group(2))
    currency = PI_CURRENCY
    if quantity is None or unit_price is None or not currency:
        return None

    quantity_unit = quantity_match.group(2).upper()
    price_unit = price_match.group(3).upper()
    if quantity_unit in {"KG", "KGS"} and price_unit in {"MT", "MTS"}:
        normalized_quantity = quantity / Decimal("1000")
    elif quantity_unit in {"MT", "MTS"} and price_unit in {"KG", "KGS"}:
        normalized_quantity = quantity * Decimal("1000")
    elif quantity_unit.rstrip("S") == price_unit.rstrip("S"):
        normalized_quantity = quantity
    else:
        return None
    return normalized_quantity * unit_price, currency, (
        quantity,
        quantity_unit,
        unit_price,
        price_unit,
    )


def reconcile_pi_total(result, ocr_text):
    """Sửa Giá tổng PI từ các phép tính có bằng chứng trong OCR."""
    payment_total = extract_pi_payment_total(ocr_text)
    quantity_total = extract_pi_quantity_price_total(ocr_text)
    calculation = payment_total or quantity_total
    if calculation is None:
        return

    total, currency, details = calculation
    calculated_value = f"{format_number(total, decimal_places=2)} {currency}"
    current_value = str(result.get("Giá tổng", "") or "").strip()
    current_number = parse_decimal(current_value)
    current_currency = detect_currency(current_value, ocr_text)
    if current_number == total and current_currency == currency:
        return

    result["Giá tổng"] = calculated_value
    result["_confidence"] = min(float(result.get("_confidence", 0) or 0), 90)
    if payment_total:
        formula = " + ".join(format(amount, "f") for _, amount, _ in details)
        explanation = f"các đợt thanh toán đủ 100%: {formula} = {format(total, 'f')} {currency}"
        if quantity_total:
            goods_total, goods_currency, goods_details = quantity_total
            quantity, quantity_unit, unit_price, price_unit = goods_details
            goods_formula = (
                f"{format(quantity, 'f')} {quantity_unit} × "
                f"{format(unit_price, 'f')} {goods_currency}/{price_unit} = "
                f"{format(goods_total, 'f')} {goods_currency}"
            )
            if goods_total == total and goods_currency == currency:
                explanation += f"; kết quả này khớp phép tính {goods_formula}"
            else:
                explanation += f"; phép tính theo hàng hóa cho kết quả khác: {goods_formula}"
    else:
        quantity, quantity_unit, unit_price, price_unit = details
        explanation = (
            f"Quantity × Unit Price: {format(quantity, 'f')} {quantity_unit} × "
            f"{format(unit_price, 'f')} {currency}/{price_unit} = "
            f"{format(total, 'f')} {currency}"
        )
    correction = (
        f"Hậu kiểm không dùng riêng khoản thanh toán {current_value or 'đang trống'}; "
        f"đã tính Giá tổng từ {explanation}."
    )
    result["_reason"] = f"{result.get('_reason', '').strip()} {correction}".strip()
    result["_pi_calculation_warning"] = correction


def normalize_result_formats(result, doc_type, ocr_text):
    """Chuẩn hóa số lượng, trọng lượng và tiền sau khi model trích xuất."""
    changed_fields = []
    if doc_type == "PKL":
        formats = {
            "Số hộp": {"integer": True},
            "Trọng lượng (NET)": {"decimal_places": 2},
        }
        for field, options in formats.items():
            original = result.get(field, "")
            if not original:
                continue
            normalized = format_number(original, **options)
            result[field] = normalized
            if normalized != original:
                changed_fields.append(field)

    if doc_type == "INV":
        for field in ("Giá tổng", "Đơn giá"):
            if not result.get(field):
                continue

            original = result[field]
            normalized, _ = normalize_money(original, ocr_text)
            result[field] = normalized

            if normalized != original:
                changed_fields.append(field)

    if changed_fields:
        note = "Đã chuẩn hóa định dạng: " + ", ".join(changed_fields) + "."
        result["_reason"] = f"{result.get('_reason', '').strip()} {note}".strip()


def reconcile_invoice_number(result, ocr_text):
    """Sửa mã INV cho mẫu có barcode trong ô INVOICE NUM."""
    normalized_text = re.sub(r"\s+", " ", str(ocr_text or "").upper())
    has_split_invoice_cells = (
        "INVOICE NUM" in normalized_text
        and "SPECIFICATION INVOICE" in normalized_text
    )
    if not has_split_invoice_cells:
        return

    barcode_candidates = list(dict.fromkeys(re.findall(
        r"\bEXP(?=[A-Z0-9./_-]*\d)[A-Z0-9./_-]{5,}\b",
        normalized_text,
    )))
    if len(barcode_candidates) != 1:
        return

    invoice_number = barcode_candidates[0]
    current_value = str(result.get("INV", "") or "").strip()
    if current_value == invoice_number:
        return

    result["INV"] = invoice_number
    result["_confidence"] = min(float(result.get("_confidence", 0) or 0), 85)
    correction = (
        f"Hậu kiểm chọn {invoice_number} vì đây là mã EXP duy nhất thuộc mẫu có "
        "ô INVOICE NUM và SPECIFICATION INVOICE riêng biệt; không dùng giá trị "
        "trong ô SPECIFICATION INVOICE."
    )
    result["_reason"] = f"{result.get('_reason', '').strip()} {correction}".strip()
    result["_inv_validation_warning"] = correction


def find_known_supplier(value):
    """Tìm NCC trong danh sách cấu hình; trả None nếu là NCC ngoài danh sách."""
    normalized_value = normalize_for_match(value)
    if not normalized_value:
        return None
    for record in NCC_RECORDS:
        normalized_name = normalize_for_match(record["name"])
        if normalized_name in normalized_value or normalized_value in normalized_name:
            return record
    return None


def countries_in_text(text):
    """Trả các tên quốc gia chuẩn được nhắc trực tiếp trong một đoạn OCR."""
    lowered = str(text or "").lower()
    countries = []
    for alias, country in PRODUCT_ORIGIN_COUNTRIES.items():
        if re.search(rf"(?<![a-z]){re.escape(alias)}(?![a-z])", lowered):
            if country not in countries:
                countries.append(country)
    return countries


def infer_product_origin(ocr_text):
    """Suy luận xuất xứ hàng từ nhãn origin hoặc vùng mô tả sản phẩm."""
    lines = [line.strip() for line in str(ocr_text or "").splitlines() if line.strip()]

    # Nhãn xuất xứ hàng hóa là căn cứ mạnh nhất; bỏ qua cột ORIGIN INV. của invoice.
    for line in lines:
        upper_line = line.upper()
        if "ORIGIN" in upper_line and "ORIGIN INV" not in upper_line:
            countries = countries_in_text(line)
            if len(countries) == 1:

                return countries[0]

    # Quốc gia nằm trong/ở sát bảng mô tả hàng, ví dụ "Corall Russia".
    product_markers = ("DESCRIPTION", "ITEM NAME", "PRODUCT NAME", "COMMODITY")
    for index, line in enumerate(lines):
        if any(marker in line.upper() for marker in product_markers):
            product_block = "\n".join(lines[index:index + 7])
            countries = countries_in_text(product_block)
            if len(countries) == 1:
                return countries[0]

    # Hỗ trợ một dòng ngắn chỉ tên NCC nguồn/nhà sản xuất và quốc gia.
    excluded_context = ("ADDRESS", "BANK", "BUYER", "CUSTOMER", "DELIVERY")
    for line in lines:
        if len(line) > 80 or any(character.isdigit() for character in line):
            continue
        if any(word in line.upper() for word in excluded_context):
            continue
        countries = countries_in_text(line)
        if len(countries) == 1 and len(line.split()) <= 8:
            return countries[0]

    return ""


def reconcile_pi_supplier(result, ocr_text):
    """Giữ bên bán trực tiếp làm NCC và xác định xuất xứ hàng hóa riêng biệt."""
    supplier = str(result.get("Nhà cung cấp", "") or "").strip()
    if not supplier:
        return

    record = find_known_supplier(supplier)
    if record is None:
        result["_supplier_source"] = "ocr"
        inferred_origin = infer_product_origin(ocr_text)
        previous_country = str(result.get("XUẤT XỨ", "") or "").strip()
        if inferred_origin and previous_country.casefold() != inferred_origin.casefold():
            result["XUẤT XỨ"] = inferred_origin
            try:
                confidence = float(result.get("_confidence", 0) or 0)
            except (TypeError, ValueError):
                confidence = 0
            result["_confidence"] = min(confidence, 85.0)
            note = (
                f"Giữ {supplier} là nhà cung cấp trực tiếp; xác định xuất xứ hàng hóa "
                f"là {inferred_origin} từ vùng mô tả hàng/NCC nguồn trong OCR."
            )
            result["_reason"] = f"{result.get('_reason', '').strip()} {note}".strip()
            result["_origin_inference_warning"] = note
        return

    previous_supplier = supplier
    previous_country = str(result.get("XUẤT XỨ", "") or "").strip()
    result["Nhà cung cấp"] = record["name"]
    result["XUẤT XỨ"] = record["country"]
    result["_supplier_source"] = "configured_list"
    if previous_supplier != record["name"] or previous_country != record["country"]:
        note = (
            f"Đã chuẩn hóa NCC {previous_supplier} thành {record['name']} và dùng "
            f"xuất xứ cố định {record['country']} từ danh sách NCC."
        )
        result["_reason"] = f"{result.get('_reason', '').strip()} {note}".strip()


HOST = os.getenv("PYTHON_OCR_HOST", "127.0.0.1")
PORT = int(os.getenv("PYTHON_OCR_PORT", "8001"))
MAX_FILE_MB = 15

def normalize_document_type(value):
    value = str(value or "").strip().upper()
    if value in {"BL", "BILL"}:
        return "Bill"
    if value not in DOCUMENTS:
        raise ValueError("documentType phải là PI, INV, PKL hoặc Bill")
    return value

def analyze_payload(payload):
    document_type = normalize_document_type(payload.get("documentType"))
    file_name = str(payload.get("fileName") or "document.pdf").strip()
    allowed = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}
    if Path(file_name).suffix.lower() not in allowed:
        raise ValueError("OCR chỉ hỗ trợ PDF, PNG, JPG, JPEG, WEBP, TIF hoặc TIFF")

    encoded = re.sub(
        r"^data:[^;]+;base64,",
        "",
        str(payload.get("fileData") or "").strip(),
        flags=re.I,
    )
    if not encoded:
        raise ValueError("Thiếu fileData")
    try:
        raw = base64.b64decode(re.sub(r"\s", "", encoded), validate=True)
    except Exception as error:
        raise ValueError(f"fileData không phải Base64 hợp lệ: {error}") from error
    if len(raw) > MAX_FILE_MB * 1024 * 1024:
        raise ValueError(f"File vượt quá {MAX_FILE_MB}MB")

    temporary_path = None
    try:
        suffix = Path(file_name).suffix.lower() or ".pdf"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(raw)
            temporary_path = temporary.name
        ocr_text, ocr_confidence, used_ocr = ocr_file(temporary_path)
        data = analyze_with_openrouter(ocr_text, document_type)
        fields = DOCUMENTS[document_type]
        final_data = data if document_type in {"INV", "Bill"} else {
            field: data.get(field, "") for field in fields
        }
        # Giữ hợp đồng response cũ của BE cho Frontend hiện tại.
        if document_type == "PKL" and not isinstance(data, list):
            final_data = {
                "Số hộp": data.get("Số hộp", ""),
                "Trọng lượng": data.get("Trọng lượng (NET)", ""),
            }
        return {
            "success": True,
            "documentType": "BL" if document_type == "Bill" else document_type,
            "fileName": file_name,
            "data": final_data,
            "_confidence": data[0].get("_confidence", 0) if isinstance(data, list) and data else data.get("_confidence", 0),
            "_reason": data[0].get("_reason", "") if isinstance(data, list) and data else data.get("_reason", ""),
            "ocrConfidence": ocr_confidence,
            "usedLocalOcr": used_ocr,
            "warnings": {
                key: value
                for item in (data if isinstance(data, list) else [data])
                for key, value in item.items()
                if key.endswith("_warning")
            },
            "modelResult": data if isinstance(data, list) else data.get("_model_result", {}),
            "models": {"ocr": OPENROUTER_MODEL_OCR},
        }
    finally:
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            ai_check, ai_details = check_openrouter_keys()
            return self.reply(200, {
                "status": "ok" if ai_check == "ok" else "degraded",
                "service": "python-ocr",
                "checks": {"ai": ai_check, "aiKeys": ai_details},
            })
        return self.reply(404, {"success": False, "message": "Route not found"})

    def do_HEAD(self):
        # Render/Docker health probes may use HEAD. Return headers without a body.
        self.send_response(200 if self.path == "/health" else 404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if self.path != "/ocr/analyze":
            return self.reply(404, {"success": False, "message": "Route not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length))
            self.reply(200, analyze_payload(payload))
        except Exception as error:
            status = getattr(error, "status_code", 400)
            status = status if 400 <= status <= 599 else 500
            print(f"[OCR] request failed ({status}): {error}", flush=True)
            self.reply(status, {"success": False, "message": str(error)})

    def reply(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"[OCR] {fmt % args}")

if __name__ == "__main__":
    print(f"Python OCR server running at http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
