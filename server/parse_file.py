import sys
import os
import zipfile
import xml.etree.ElementTree as ET
import pypdf

# Set stdout to use utf-8
if sys.version_info >= (3, 7):
    sys.stdout.reconfigure(encoding='utf-8')

def get_docx_text(path):
    try:
        with zipfile.ZipFile(path) as docx:
            xml_content = docx.read('word/document.xml')
            tree = ET.fromstring(xml_content)
        
        w_namespace = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        paragraphs = []
        for paragraph in tree.iter(f'{w_namespace}p'):
            texts = []
            for node in paragraph.iter(f'{w_namespace}t'):
                if node.text:
                    texts.append(node.text)
            if texts:
                paragraphs.append("".join(texts))
            else:
                paragraphs.append("")
        return "\n".join(paragraphs)
    except Exception as e:
        return f"Error reading Docx: {str(e)}"

def get_pdf_text(path):
    try:
        reader = pypdf.PdfReader(path)
        text = ""
        for i, page in enumerate(reader.pages):
            text += page.extract_text() + "\n"
        return text
    except Exception as e:
        return f"Error reading PDF: {str(e)}"

def get_pptx_text(path):
    """Extrai o texto de cada slide de um .pptx, preservando a ordem dos slides."""
    try:
        a_ns = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
        slides_text = []
        with zipfile.ZipFile(path) as pptx:
            slide_names = sorted(
                [n for n in pptx.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml')],
                key=lambda n: int(''.join(filter(str.isdigit, os.path.basename(n))) or 0)
            )
            for idx, name in enumerate(slide_names, start=1):
                tree = ET.fromstring(pptx.read(name))
                paragraphs = []
                for paragraph in tree.iter(f'{a_ns}p'):
                    texts = [node.text for node in paragraph.iter(f'{a_ns}t') if node.text]
                    if texts:
                        paragraphs.append("".join(texts))
                body = "\n".join(paragraphs).strip()
                slides_text.append(f"=== SLIDE {idx} ===\n{body if body else '(sem texto)'}")
        if not slides_text:
            return "(Apresentacao sem slides legiveis)"
        return "\n\n".join(slides_text)
    except Exception as e:
        return f"Error reading Pptx: {str(e)}"

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python parse_file.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    ext = os.path.splitext(file_path)[1].lower()

    if ext == '.pdf':
        print(get_pdf_text(file_path))
    elif ext in ['.docx', '.doc']:
        print(get_docx_text(file_path))
    elif ext == '.pptx':
        print(get_pptx_text(file_path))
    else:
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                print(f.read())
        except Exception as e:
            print(f"Error reading plain text file: {str(e)}")
