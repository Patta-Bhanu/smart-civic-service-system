
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text, inspect

from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.complaints import router as complaints_router
from app.api.authority import router as authority_router
from app.api.departments import router as departments_router
from app.core.database import Base, engine
from app import models
from app.models.department import Department


# Create the FastAPI application
app = FastAPI(
    title="Smart Civic Issue Reporting System",
    description=(
        "API for reporting civic issues, assigning departments, "
        "tracking complaint status, and uploading complaint media."
    ),
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    # Allows the Vite dev server to be opened from a phone/tablet on the same
    # private LAN. Production deployments should configure explicit origins.
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure local storage for complaint photos and audio
UPLOAD_DIR = Path("uploads").resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# Serve uploaded files at /uploads/<filename>
app.mount(
    "/uploads",
    StaticFiles(directory=str(UPLOAD_DIR)),
    name="uploads",
)


# Register API routers
app.include_router(auth_router)
app.include_router(complaints_router)
app.include_router(authority_router)
app.include_router(departments_router)


# Create tables that do not already exist
Base.metadata.create_all(bind=engine)

# Lightweight forward-only migration for databases created by earlier versions.
# create_all creates missing tables but does not add columns to existing tables.
with engine.begin() as connection:
    inspector = inspect(connection)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "phone" not in user_columns:
        connection.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR(30)"))
    if "address" not in user_columns:
        connection.execute(text("ALTER TABLE users ADD COLUMN address VARCHAR(500)"))
    if "latitude" not in user_columns:
        connection.execute(text("ALTER TABLE users ADD COLUMN latitude DOUBLE PRECISION"))
    if "longitude" not in user_columns:
        connection.execute(text("ALTER TABLE users ADD COLUMN longitude DOUBLE PRECISION"))
    complaint_columns = {column["name"] for column in inspector.get_columns("complaints")}
    if "support_count" not in complaint_columns:
        connection.execute(text("ALTER TABLE complaints ADD COLUMN support_count INTEGER NOT NULL DEFAULT 0"))
    if "is_archived" not in complaint_columns:
        connection.execute(text("ALTER TABLE complaints ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE"))
    if "archived_reason" not in complaint_columns:
        connection.execute(text("ALTER TABLE complaints ADD COLUMN archived_reason TEXT"))
    if "due_at" not in complaint_columns:
        connection.execute(text("ALTER TABLE complaints ADD COLUMN due_at TIMESTAMPTZ"))
        connection.execute(text("UPDATE complaints SET due_at = created_at + INTERVAL '72 hours' WHERE due_at IS NULL"))
    if "escalated_at" not in complaint_columns:
        connection.execute(text("ALTER TABLE complaints ADD COLUMN escalated_at TIMESTAMPTZ"))
    department_columns = {column["name"] for column in inspector.get_columns("departments")}
    for column_name, sql_type in {
        "category": "VARCHAR(100)", "phone": "VARCHAR(30)", "address": "VARCHAR(500)", "email": "VARCHAR(255)"
    }.items():
        if column_name not in department_columns:
            connection.execute(text(f"ALTER TABLE departments ADD COLUMN {column_name} {sql_type}"))


# Home endpoint
@app.get("/")
def home():
    return {
        "message": "Smart Civic System API is running"
    }


# Health check
@app.get("/health")
def health_check():
    return {
        "status": "healthy"
    }


# Database connection check
@app.get("/db-check")
def database_check():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))

    return {
        "database": "connected"
    }


# List registered database tables
@app.get("/tables")
def list_tables():
    return {
        "tables": sorted(Base.metadata.tables.keys())
    }


@app.get("/departments")
def list_departments():
    """List active departments for complaint assignment dropdowns."""
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        departments = db.query(Department).filter(Department.is_active.is_(True)).order_by(Department.name.asc()).all()
        return [
            {"id": item.id, "name": item.name, "description": item.description}
            for item in departments
        ]
    finally:
        db.close()
