FROM rocm/pytorch:rocm6.2.4_ubuntu22.04_py3.10_pytorch_2.5.1

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn httpx scikit-learn numpy

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8002

CMD ["python", "main.py"]
