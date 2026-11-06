FROM python:3.13-slim

WORKDIR /app

# Installed from the CPU lock (requirements-lock.txt without CUDA wheels: the host has
# no GPU) — full transitive pin set, via `pip freeze` — rather
# than requirements.txt directly, for a reproducible build — regenerate both
# together (pip install -r requirements.txt && pip freeze > requirements-lock.txt)
# when bumping a dependency. Pinned against Python 3.13, matching this image.
COPY requirements-cpu-lock.txt .
RUN pip install --no-cache-dir -r requirements-cpu-lock.txt

# selftest.py ships in the image: the release gate is
# `docker compose exec matching-service python selftest.py`.
COPY pipeline.py main.py selftest.py rules_scorer.py rules_lexicon.py rules_selftest.py rules_cache_selftest.py ./

# Pre-download the pinned embedding model (pipeline.EMB_MODEL_REVISION) at
# build time, so the first request after start doesn't pay the download cost
# and the container never re-resolves the model by name. Plain HTTPS instead
# of the Xet transfer, which stalled for hours in a local build; prefetch_model
# retries a transient failure and fails the build if the weights never arrive.
RUN HF_HUB_DISABLE_XET=1 python -c "import pipeline; pipeline.prefetch_model()"

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
