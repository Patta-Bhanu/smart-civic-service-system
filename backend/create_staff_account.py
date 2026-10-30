"""Create an authorized staff or authority login from the backend folder.

Run: python create_staff_account.py
This utility never creates staff roles through public registration.
"""
from getpass import getpass

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.department import Department
from app.models.user import User


def main():
    db = SessionLocal()
    try:
        print("Create an internal Smart Civic System account")
        role = input("Role (department_staff/authority): ").strip().lower()
        if role not in {"department_staff", "authority"}:
            raise SystemExit("Role must be department_staff or authority.")

        full_name = input("Full name: ").strip()
        email = input("Email: ").strip().lower()
        if not full_name or not email:
            raise SystemExit("Name and email are required.")
        if db.query(User).filter(User.email == email).first():
            raise SystemExit("That email is already registered.")

        department_id = None
        if role == "department_staff":
            departments = db.query(Department).filter(Department.is_active.is_(True)).order_by(Department.name).all()
            if not departments:
                name = input("No departments exist. Enter department name to create: ").strip()
                if not name:
                    raise SystemExit("A department is required for staff accounts.")
                department = Department(name=name, description="Created during staff account setup")
                db.add(department)
                db.flush()
                departments = [department]
            print("Available departments:")
            for department in departments:
                print(f"  {department.id}: {department.name}")
            try:
                department_id = int(input("Department ID: ").strip())
            except ValueError:
                raise SystemExit("Department ID must be a number.")
            if not any(d.id == department_id for d in departments):
                raise SystemExit("Choose an active department ID from the list.")

        password = getpass("Temporary password (minimum 8 characters): ")
        if len(password) < 8:
            raise SystemExit("Password must contain at least 8 characters.")
        confirm = getpass("Confirm password: ")
        if password != confirm:
            raise SystemExit("Passwords do not match.")

        account = User(
            full_name=full_name,
            email=email,
            hashed_password=hash_password(password),
            role=role,
            department_id=department_id,
            is_active=True,
        )
        db.add(account)
        db.commit()
        print(f"Created {role} account for {email}.")
        print("Sign in through the matching separate portal in the frontend.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
