from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import gemini_keys_router, tools_management_router

app = FastAPI(title="BA Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tools_management_router)
app.include_router(gemini_keys_router)
