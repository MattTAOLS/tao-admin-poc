FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# News worker (wave D): daily company news and adverse-media screening. Own container, own Redis queue (NEWS_QUEUE).
