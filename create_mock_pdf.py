from reportlab.pdfgen import canvas
from io import BytesIO

def create_mock_pdf(filename, text):
    c = canvas.Canvas(filename)
    c.drawString(100, 750, text)
    c.save()

if __name__ == "__main__":
    text = "FIR REPORT: On 15th March 2026, a house-breaking incident occurred at Andheri East. One gold necklace and cash worth 50,000 INR were stolen. The accused is identified as Ramesh Kumar."
    create_mock_pdf("mock_fir.pdf", text)
