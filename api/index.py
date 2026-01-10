import random
import os
import requests
import sqlite3
import re
import logging
import hmac
import hashlib
from flask import Flask, request, render_template_string, jsonify, session, redirect, url_for, abort
from urllib.parse import urlparse
from dotenv import load_dotenv

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)

# SECURITY CONFIG
app.secret_key = os.environ.get("SECRET_KEY", "CHANGE_THIS_TO_A_LONG_RANDOM_STRING")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")

# SMS Gateway Config
SMS_LOGIN = os.environ.get("ANDROID_SMS_GATEWAY_LOGIN")
SMS_PASS = os.environ.get("ANDROID_SMS_GATEWAY_PASSWORD")
SMS_URL = os.environ.get("ANDROID_SMS_GATEWAY_API_URL", "https://api.sms-gate.app/3rdparty/v1")

DATABASE_URL = os.environ.get("POSTGRES_URL")
DB_NAME = "customers.db"


# --- HELPERS ---
def get_random_bg():
    """Finds a valid background image from the static folder."""
    static_folder = os.path.join(app.root_path, 'static')
    try:
        files = os.listdir(static_folder)
        bg_files = [f for f in files if f.startswith('bg') and f.lower().endswith(('.png', '.jpg', '.jpeg'))]
        if bg_files:
            return random.choice(bg_files)
    except Exception as e:
        logger.warning(f"Could not list static files: {e}")
    return "bg1.png"


def get_db():
    try:
        url = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
        if url:
            if "sslmode" not in url:
                url += "?sslmode=require"
            import psycopg2
            conn = psycopg2.connect(url)
            return conn, "postgres"
        else:
            conn = sqlite3.connect(DB_NAME)
            return conn, "sqlite"
    except Exception as e:
        logger.error(f"Database Connection Failed: {e}")
        print(f"CRITICAL DB ERROR: {e}")
        raise


def init_db():
    try:
        conn, db_type = get_db()
        schema = '''
            CREATE TABLE IF NOT EXISTS customers (
                phone TEXT PRIMARY KEY,
                name TEXT,
                active BOOLEAN DEFAULT 1
            )
        '''
        if db_type == "postgres":
            schema = schema.replace("DEFAULT 1", "DEFAULT TRUE")

        if db_type == "sqlite":
            conn.execute(schema)
        else:
            cur = conn.cursor()
            cur.execute(schema)
            cur.close()
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Init DB Failed: {e}")


def format_phone(p):
    if not p: return ""
    clean = re.sub(r'\D', '', p)
    if clean.startswith('05') and len(clean) == 10: return '+972' + clean[1:]
    if clean.startswith('972') and len(clean) == 12: return '+' + clean
    return clean


# --- SECURITY ---
def generate_secure_token(phone):
    data = f"{phone}:{app.secret_key}"
    return hmac.new(data.encode(), digestmod=hashlib.sha256).hexdigest()[:16]


def verify_token(phone, token):
    expected = generate_secure_token(phone)
    return hmac.compare_digest(expected, token)


# --- TEMPLATE ---
HTML_BASE = """
<!DOCTYPE html>
<html lang="en" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ title }}</title>
    <style>
        @keyframes slideShow {
            0% { background-image: url('/static/bg1.png'); }
            20% { background-image: url('/static/bg2.png'); }
            40% { background-image: url('/static/bg3.jpg'); }
            60% { background-image: url('/static/bg4.png'); }
            80% { background-image: url('/static/bg5.png'); }
            100% { background-image: url('/static/bg1.png'); }
        }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; padding: 0;
            background-color: #000;
            background-image: url('/static/bg1.png'); 
            background-size: cover;
            background-position: center;
            background-attachment: fixed;
            animation: slideShow 35s infinite;
            position: relative; 
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        body::before {
            content: "";
            position: absolute; top:0; left:0; right:0; bottom:0;
            background: rgba(0,0,0,0.5);
            z-index: -1;
        }
        .container {
            z-index: 1;
            background: rgba(255, 255, 255, 0.95);
            padding: 40px; 
            border-radius: 15px; 
            width: 90%; 
            max-width: 400px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.3); 
            text-align: center; 
        }
        h2 { color: #d32f2f; margin-bottom: 10px; font-size: 28px; }
        p { color: #555; margin-bottom: 20px; font-size: 16px; }
        .logo-area { font-size: 50px; margin-bottom: 10px; }
        input, textarea { 
            width: 100%; padding: 12px; margin: 10px 0; 
            border: 2px solid #eee; border-radius: 8px; 
            box-sizing: border-box; font-size: 16px; text-align: right; 
        }
        button { 
            background: #d32f2f; color: white; border: none; padding: 15px; width: 100%; 
            border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; margin-top: 10px;
        }
        button:hover { background: #b71c1c; }
        .success { color: green; font-weight:bold; }
        .error { color: red; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo-area">🍣🥢</div>
        {{ content | safe }}
    </div>
</body>
</html>
"""


# --- ROUTES ---

@app.route('/')
def home():
    random_bg = get_random_bg()
    content = """
        <h2>מועדון ה-VIP שלנו</h2>
        <p>הירשמו לקבלת הטבות בלעדיות, מבצעי 1+1 ועדכונים חמים!</p>
        <form action="/submit" method="POST">
            <input type="text" name="name" placeholder="שם מלא" required maxlength="50">
            <input type="tel" name="phone" placeholder="טלפון (050-1234567)" required maxlength="20" style="direction:ltr; text-align:right;">
            <button type="submit">הצטרף למועדון</button>
        </form>
        <br>
        <small><a href="/login" style="color:#888;">כניסת מנהל</a></small>
    """
    return render_template_string(HTML_BASE, title="Sushi VIP", content=content, bg_image=random_bg)


@app.route('/submit', methods=['POST'])
def submit():
    random_bg = get_random_bg()
    name = request.form.get('name', '').strip()
    raw_phone = request.form.get('phone', '').strip()
    phone = format_phone(raw_phone)

    if len(phone) < 10 or not phone.startswith('+'):
        return render_template_string(HTML_BASE, title="שגיאה",
                                      content="<h3 class='error'>מספר טלפון לא תקין</h3><a href='/'>חזור</a>")

    try:
        conn, db_type = get_db()
        q_sql = 'INSERT INTO customers (phone, name, active) VALUES (?, ?, 1) ON CONFLICT(phone) DO UPDATE SET active=1, name=excluded.name'
        q_pg = 'INSERT INTO customers (phone, name, active) VALUES (%s, %s, TRUE) ON CONFLICT(phone) DO UPDATE SET active=TRUE, name=EXCLUDED.name'

        if db_type == "sqlite":
            conn.execute(q_sql, (phone, name))
        else:
            cur = conn.cursor()
            cur.execute(q_pg, (phone, name))
            cur.close()
        conn.commit()
    except Exception as e:
        logger.error(f"Submit Error: {e}")
        return render_template_string(HTML_BASE, title="שגיאה", content="<h3 class='error'>תקלה במערכת</h3>")
    finally:
        if 'conn' in locals(): conn.close()

    return render_template_string(HTML_BASE, title="תודה",
                                  content="<h2 class='success'>✅ נרשמת בהצלחה!</h2><a href='/'>חזור</a>",
                                  bg_image=random_bg)


@app.route('/login', methods=['GET', 'POST'])
def login():
    random_bg = get_random_bg()
    if request.method == 'POST':
        if request.form.get('password') == ADMIN_PASSWORD:
            session['logged_in'] = True
            return redirect('/admin')
        return render_template_string(HTML_BASE, title="Login",
                                      content="<h2>שגיאה</h2><p>סיסמה שגויה</p><a href='/login'>נסה שוב</a>")

    content = """
    <h2>כניסת מנהל</h2>
    <form method="POST">
        <input type="password" name="password" placeholder="סיסמה" required style="direction:ltr;">
        <button type="submit" style="background:#333;">כניסה</button>
    </form>
    """
    return render_template_string(HTML_BASE, title="Login", content=content, bg_image=random_bg)


@app.route('/admin')
def admin():
    if not session.get('logged_in'): return redirect('/login')

    conn, db_type = get_db()
    try:
        q = "SELECT phone, name, active FROM customers ORDER BY active DESC, name ASC"
        if db_type == "sqlite":
            cur = conn.execute(q)
            rows = cur.fetchall()
        else:
            cur = conn.cursor()
            cur.execute(q)
            rows = cur.fetchall()
            cur.close()
    finally:
        conn.close()

    active_count = sum(1 for r in rows if r[2])
    msg = request.args.get('msg', '')

    table_rows = ""
    for r in rows:
        phone = r[0]
        status = '<span class="success">פעיל</span>' if r[2] else '<span class="error">הוסר</span>'

        if r[2]:
            link = url_for('toggle_status', phone=phone, action='block')
            action_btn = f'<a href="{link}" style="color:red; font-size:12px;">חסימה</a>'
        else:
            link = url_for('toggle_status', phone=phone, action='unblock')
            action_btn = f'<a href="{link}" style="color:green; font-size:12px;">שחזור</a>'

        table_rows += f"""
           <tr>
               <td>{r[1]}</td>
               <td style="direction:ltr; text-align:right;">{phone}</td>
               <td>{status}</td>
               <td>{action_btn}</td>
           </tr>
           """

    admin_html = f"""
    <div style="direction:rtl; text-align:right;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <h2 style="margin:0;">ניהול לקוחות 🍣</h2>
            <a href="/logout" style="background:#333; color:white; padding:5px 10px; border-radius:4px; text-decoration:none; font-size:14px;">יציאה</a>
        </div>

        <div style="background:#fff; padding:20px; border:1px solid #eee; border-radius:8px; margin-bottom:20px;">
            <h3 style="margin-top:0;">📢 שליחת הודעה ({active_count} פעילים)</h3>
            <form action="/admin/broadcast" method="POST" onsubmit="return confirm('לשלוח לכולם?');">
                <textarea name="message" placeholder="הקלד הודעה כאן..." required style="height:80px;"></textarea>
                <div style="margin-top:5px; font-size:12px; color:gray;">* קישור הסרה יתווסף אוטומטית</div>
                <button type="submit" style="margin-top:10px;">🚀 שלח הודעה</button>
            </form>
            <p style="color:blue; font-weight:bold;">{msg}</p>
        </div>

        <h3 style="border-bottom:2px solid #d32f2f; padding-bottom:5px; display:inline-block;">רשימת לקוחות ({len(rows)})</h3>
        <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; margin-top:10px;">
                <thead style="background:#f9f9f9;">
                    <tr>
                        <th style="padding:10px; border-bottom:1px solid #ddd;">שם</th>
                        <th style="padding:10px; border-bottom:1px solid #ddd;">טלפון</th>
                        <th style="padding:10px; border-bottom:1px solid #ddd;">סטטוס</th>
                        <th style="padding:10px; border-bottom:1px solid #ddd;">פעולה</th>
                    </tr>
                </thead>
                <tbody>
                    {table_rows}
                </tbody>
            </table>
        </div>
    </div>
    """
    return render_template_string(HTML_BASE, title="Admin", content=admin_html)


# --- BROADCAST (FIXED FOR VERCEL) ---
@app.route('/admin/broadcast', methods=['POST'])
def broadcast():
    if not session.get('logged_in'): return redirect('/login')

    message = request.form.get('message')
    print(f"DEBUG: Broadcast started. Message len: {len(message)}")  # DEBUG

    # 1. Get Recipients
    conn, db_type = get_db()
    try:
        q = "SELECT phone FROM customers WHERE active=TRUE" if db_type == "postgres" else "SELECT phone FROM customers WHERE active=1"
        if db_type == "postgres":
            cur = conn.cursor()
            cur.execute(q)
            recipients = cur.fetchall()
        else:
            recipients = conn.execute(q).fetchall()
        print(f"DEBUG: Found {len(recipients)} recipients")  # DEBUG
    finally:
        conn.close()

    # 2. Get Config
    qstash_token = os.environ.get("QSTASH_TOKEN")
    if not qstash_token:
        print("DEBUG: ERROR - QSTASH_TOKEN is missing!")  # DEBUG
        return redirect(url_for('admin', msg="Error: Missing QSTASH_TOKEN"))

    # 3. Manual URL
    base_url = "https://oshioshi-gedera-sms.vercel.app"
    target_endpoint = f"{base_url}/api/send_sms_task"
    print(f"DEBUG: Target Endpoint: {target_endpoint}")  # DEBUG

    # 4. Send
    headers = {
        "Authorization": f"Bearer {qstash_token}",
        "Content-Type": "application/json"
    }

    count = 0
    for row in recipients:
        phone = row[0]
        try:
            print(f"DEBUG: Sending to {phone}...")  # DEBUG
            resp = requests.post(
                f"https://qstash.upstash.io/v2/publish/{target_endpoint}",
                headers=headers,
                json={
                    "phone": phone,
                    "message": message,
                    "secret": app.secret_key
                },
                timeout=5
            )
            print(f"DEBUG: QStash Response: {resp.status_code} - {resp.text}")  # DEBUG
            if resp.status_code == 200 or resp.status_code == 201 or resp.status_code == 202:
                count += 1
            else:
                print(f"DEBUG: Failed QStash for {phone}: {resp.text}")
        except Exception as e:
            print(f"DEBUG: Exception for {phone}: {e}")

    return redirect(url_for('admin', msg=f"Sent to queue: {count}"))
@app.route('/api/send_sms_task', methods=['POST'])
def send_sms_task():
    data = request.json
    if data.get('secret') != app.secret_key:
        return "Unauthorized", 401

    phone = data.get('phone')
    message = data.get('message')

    token = generate_secure_token(phone)
    clean = phone.replace('+', '')
    unsub_link = f"{request.url_root}unsubscribe/{clean}?token={token}"
    unsub_text = "להסרה:"
    final_msg = f"{message}\n\n{unsub_text} {unsub_link}"

    try:
        payload = {"message": final_msg, "phoneNumbers": [phone], "withDeliveryReport": True}
        resp = requests.post(f"{SMS_URL.rstrip('/')}/messages", json=payload, auth=(SMS_LOGIN, SMS_PASS), timeout=10)
        resp.raise_for_status()
        return jsonify({"status": "sent", "phone": phone})
    except Exception as e:
        logger.error(f"Worker SMS Fail {phone}: {e}")
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route('/unsubscribe/<phone>')
def unsubscribe(phone):
    token = request.args.get('token')
    if not token: abort(403, "Missing Token")

    candidate_phone = "+" + phone if not phone.startswith('+') else phone
    if not verify_token(candidate_phone, token):
        if not verify_token(phone, token):
            abort(403, "Invalid Signature")

    try:
        conn, db_type = get_db()
        q_sql = "UPDATE customers SET active=0 WHERE phone=?"
        q_pg = "UPDATE customers SET active=FALSE WHERE phone=%s"

        if db_type == "sqlite":
            conn.execute(q_sql, (candidate_phone,))
        else:
            cur = conn.cursor()
            cur.execute(q_pg, (candidate_phone,))
            cur.close()
        conn.commit()
    finally:
        if 'conn' in locals(): conn.close()

    return render_template_string(HTML_BASE, title="הוסרת", content="<h2 class='success'>הוסרת בהצלחה</h2>")


@app.route('/admin/toggle')
def toggle_status():
    if not session.get('logged_in'): return redirect('/login')
    phone = request.args.get('phone')
    action = request.args.get('action')
    if not phone or not action: return redirect('/admin')

    clean_phone = phone.strip()
    if not clean_phone.startswith('+') and clean_phone.startswith('972'):
        clean_phone = '+' + clean_phone
    elif not clean_phone.startswith('+'):
        clean_phone = '+' + clean_phone.lstrip()

    conn, db_type = get_db()
    try:
        if db_type == "sqlite":
            new_status = 1 if action == 'unblock' else 0
            conn.execute("UPDATE customers SET active=? WHERE phone=?", (new_status, clean_phone))
        else:
            cur = conn.cursor()
            pg_bool = True if action == 'unblock' else False
            cur.execute("UPDATE customers SET active=%s WHERE phone=%s", (pg_bool, clean_phone))
            cur.close()
        conn.commit()
    finally:
        conn.close()
    return redirect('/admin')


@app.route('/force-init')
def force_init():
    try:
        conn, db_type = get_db()
        cur = conn.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS customers (
                phone TEXT PRIMARY KEY,
                name TEXT,
                active BOOLEAN DEFAULT TRUE
            );
        ''')
        conn.commit()
        conn.close()
        return "✅ Table 'customers' created successfully!"
    except Exception as e:
        return f"❌ Error: {e}"


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)
