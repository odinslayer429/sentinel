import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
import bcrypt
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import User

logger = logging.getLogger(__name__)

# Security configuration
SECRET_KEY = "super_secret_enterprise_key_change_in_production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token", auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against the hashed string."""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    """Generate bcrypt hash for a password."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Generate JWT encoded token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

import os

# Set this to True for local development/demo bypass
GUEST_MODE = True 

async def get_current_user(token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    """
    FastAPI Dependency to inject the currently authenticated user.
    BYPASS: Returns 'officer01' automatically if GUEST_MODE is active.
    """
    # 1. Immediate Guest Bypass
    if GUEST_MODE:
        user = db.query(User).filter(User.username == "officer01").first()
        if user: 
            return user

    # 2. Strict Auth Flow (if not guest)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.username == username).first()
    if user is None or not user.is_active:
        raise credentials_exception
        
    return user

async def get_current_active_dispatcher(current_user: User = Depends(get_current_user)) -> User:
    """Dependency: Restrict route to Admin or Dispatcher."""
    if current_user.role not in ["Admin", "Dispatcher"]:
        raise HTTPException(status_code=403, detail="Not enough privileges.")
    return current_user

