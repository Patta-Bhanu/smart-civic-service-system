"""Create an authority login locally; there is intentionally no public authority registration."""
from getpass import getpass
from sqlalchemy.orm import Session
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.user import User


def main():
    name = input("Authority officer full name: ").strip()
    email = input("Authority email: ").strip().lower()
    password = getpass("Initial password (min 8 characters): ")
    if len(name) < 2 or len(email) < 5 or len(password) < 8:
        raise SystemExit("Name, email, or password is invalid.")
    db: Session = SessionLocal()
    try:
        if db.query(User).filter(User.email == email).first():
            raise SystemExit("An account with that email already exists.")
        user = User(full_name=name, email=email, hashed_password=hash_password(password),
                    role="authority", is_active=True)
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"Authority account created. User ID: {user.id}")
        print("Sign in through the Authority portal. The first sign-in will ask you to save your location on the map.")
    finally:
        db.close()

if __name__ == "__main__":
    main()
