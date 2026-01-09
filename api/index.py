import random

from flask import Flask, request, render_template_string, jsonify, session, redirect, url_for, abort
import os
import requests
import sqlite3
import re
import logging
import hmac
import hashlib
from urllib.parse import urlparse
from dotenv import load_dotenv
from qstash import QStash  # pip install qstash

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

app = Flask(__name__)

# SECURITY CONFIG
# IMPORTANT: This key MUST be constant and secret for unsubscribe tokens to work!
# In Vercel/Prod: Set this in Environment Variables.
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
    # List all files in static folder
    static_folder = os.path.join(app.root_path, 'static')
    try:
        files = os.listdir(static_folder)
        # Filter only images starting with 'bg'
        bg_files = [f for f in files if f.startswith('bg') and f.lower().endswith(('.png', '.jpg', '.jpeg'))]

        if bg_files:
            return random.choice(bg_files)
    except Exception as e:
        logger.warning(f"Could not list static files: {e}")

    # Fallback if something breaks or folder is empty
    return "bg1.png"


def get_db():
    try:
        # 1. Try to get the Postgres URL (Neon/Vercel)
        # We prefer POSTGRES_URL, but fallback to DATABASE_URL if needed.
        url = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")

        if url:
            # 2. Fix SSL for Neon (Required for Vercel)
            if "sslmode" not in url:
                url += "?sslmode=require"

            # 3. Connect using psycopg2
            import psycopg2
            conn = psycopg2.connect(url)
            return conn, "postgres"
        else:
            # 4. Fallback to local SQLite (Only for local testing)
            conn = sqlite3.connect(DB_NAME)
            return conn, "sqlite"
    except Exception as e:
        logger.error(f"Database Connection Failed: {e}")
        # This print will show up in Vercel Logs so you can see WHY it failed
        print(f"CRITICAL DB ERROR: {e}")
        raise

def init_db():
    conn, db_type = get_db()
    try:
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
    except Exception as e:
        logger.error(f"Init DB Failed: {e}")
    finally:
        conn.close()

@app.route('/force-init')
def force_init():
    try:
        conn, db_type = get_db()
        cur = conn.cursor()
        # Explicitly create the table for Postgres
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

def format_phone(p):
    if not p: return ""
    clean = re.sub(r'\D', '', p)
    if clean.startswith('05') and len(clean) == 10: return '+972' + clean[1:]
    if clean.startswith('972') and len(clean) == 12: return '+' + clean
    return clean


# --- SECURITY: SIGNATURE GENERATOR ---
def generate_secure_token(phone):
    """Creates a signature for the phone number using our SECRET_KEY."""
    data = f"{phone}:{app.secret_key}"
    return hmac.new(data.encode(), digestmod=hashlib.sha256).hexdigest()[:16]  # 16 chars is enough


def verify_token(phone, token):
    """Checks if the token matches the phone."""
    expected = generate_secure_token(phone)
    return hmac.compare_digest(expected, token)


# --- HTML TEMPLATES ---
HTML_BASE = """
<!DOCTYPE html>
<html lang="en" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ title }}</title>
    <style>
        /* Corrected SlideShow with Mixed JPG/PNG */
        @keyframes slideShow {
            0% { background-image: url('/static/bg1.png'); }
            5% { background-image: url('/static/bg2.png'); }
            25% { background-image: url('/static/bg3.jpg'); }
            30% { background-image: url('/static/bg4.png'); }
            35% { background-image: url('/static/bg5.png'); }
            40% { background-image: url('/static/bg6.png'); }
            80% { background-image: url('/static/bg7.png'); }
            100% { background-image: url('/static/bg1.png'); }
        }

        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; padding: 0;

            /* Fallback Image (PNG) */
            background-color: #000;
            background-image: url('/static/bg1.png'); 

            background-size: cover;
            background-position: center;
            background-attachment: fixed;

            /* Animation: 35s total, infinite loop */
            animation: slideShow 35s infinite;

            position: relative; 
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* Dark Overlay so text is readable */
        body::before {
            content: "";
            position: absolute; top:0; left:0; right:0; bottom:0;
            background: rgba(0,0,0,0.5); /* 50% Dark Tint */
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
            box-sizing: border-box; font-size: 16px; 
            text-align: right; 
        }
        button { 
            background: #d32f2f; color: white; border: none; padding: 15px; width: 100%; 
            border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; 
            margin-top: 10px;
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
    random_bg = get_random_bg()  # <--- Use helper
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
    return render_template_string(HTML_BASE, title="Sushi VIP", content=content,bg_image=random_bg)


@app.route('/submit', methods=['POST'])
def submit():
    random_bg = get_random_bg()  # <--- Use helper
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
                                  content="<h2 class='success'>✅ נרשמת בהצלחה!</h2><a href='/'>חזור</a>",bg_image=random_bg)


@app.route('/login', methods=['GET', 'POST'])
def login():
    random_bg = get_random_bg()  # <--- Use helper
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
    return render_template_string(HTML_BASE, title="Login", content=content,bg_image=random_bg)


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

    # Generate Table HTML
    table_rows = ""
    for r in rows:
        phone = r[0]
        status = '<span class="badge badge-active">פעיל</span>' if r[
            2] else '<span class="badge badge-unsub">הוסר</span>'

        # USE QUERY PARAMETERS for safety (avoids URL encoding bugs)
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

        <!-- BROADCAST BOX -->
        <div style="background:#fff; padding:20px; border:1px solid #eee; border-radius:8px; margin-bottom:20px;">
            <h3 style="margin-top:0;">📢 שליחת הודעה ({active_count} פעילים)</h3>
            <form action="/admin/broadcast" method="POST" onsubmit="return confirm('לשלוח לכולם?');">
                <textarea name="message" placeholder="הקלד הודעה כאן..." required style="height:80px;"></textarea>
                <div style="margin-top:5px; font-size:12px; color:gray;">* קישור הסרה יתווסף אוטומטית</div>
                <button type="submit" style="margin-top:10px;">🚀 שלח הודעה</button>
            </form>
            <p style="color:blue; font-weight:bold;">{msg}</p>
        </div>

        <!-- CUSTOMER TABLE -->
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

    # Pick a random background but keep it simple for admin
    # Or just use the same slideshow
    return render_template_string(HTML_BASE, title="Admin", content=admin_html)



# --- NEW BROADCAST LOGIC FOR VERCEL ---
@app.route('/admin/broadcast', methods=['POST'])
def broadcast():
    if not session.get('logged_in'): return redirect('/login')

    message = request.form.get('message')
    if not message: return redirect('/admin')

    # 1. Get All Active Users
    conn, db_type = get_db()
    try:
        q = "SELECT phone FROM customers WHERE active=1" if db_type == "sqlite" else "SELECT phone FROM customers WHERE active=TRUE"
        if db_type == "postgres":
            cur = conn.cursor()
            cur.execute(q)
            recipients = cur.fetchall()
        else:
            recipients = conn.execute(q).fetchall()
    finally:
        conn.close()

    # 2. DETECT ENVIRONMENT (Local vs Vercel)
    # If we have QSTASH_TOKEN, we assume we want to use the Queue
    qstash_token = os.environ.get("QSTASH_TOKEN")

    if qstash_token:
        # --- VERCEL MODE (Async Queue) ---
        # UPDATED CLIENT NAME
        client = QStash(token=qstash_token)

        base_url = os.environ.get("VERCEL_URL")
        if not base_url:
            base_url = request.url_root.rstrip('/')
        else:
            base_url = "https://" + base_url

        target_endpoint = f"{base_url}/api/send_sms_task"

        count = 0
        for row in recipients:
            phone = row[0]
            # UPDATED METHOD CALL (.message.publish_json)
            client.message.publish_json(
                url=target_endpoint,
                body={
                    "phone": phone,
                    "message": message,
                    "secret": app.secret_key
                }
            )
            count += 1

        return redirect(url_for('admin', msg=f"התחלנו שליחה ל-{count} לקוחות (ברקע)"))

    else:
        # --- LOCAL MODE (Simple Loop) ---
        # Fallback if no QStash token found (e.g. testing on laptop)
        success, fail = 0, 0
        unsub_text = "להסרה:"

        for row in recipients:
            phone = row[0]
            token = generate_secure_token(phone)
            clean = phone.replace('+', '')
            unsub_link = f"{request.url_root}unsubscribe/{clean}?token={token}"
            final = f"{message}\n\n{unsub_text} {unsub_link}"

            try:
                payload = {"message": final, "phoneNumbers": [phone], "withDeliveryReport": True}
                requests.post(f"{SMS_URL.rstrip('/')}/messages", json=payload, auth=(SMS_LOGIN, SMS_PASS), timeout=5)
                success += 1
            except:
                fail += 1

        return redirect(url_for('admin', msg=f"נשלח: {success}, נכשל: {fail}"))


# --- NEW WORKER ROUTE (Called by QStash) ---
@app.route('/api/send_sms_task', methods=['POST'])
def send_sms_task():
    data = request.json

    # 1. Security Check
    if data.get('secret') != app.secret_key:
        return "Unauthorized", 401

    phone = data.get('phone')
    message = data.get('message')

    # 2. Generate Unsub Link
    token = generate_secure_token(phone)
    clean = phone.replace('+', '')
    # Note: request.url_root here will be the Vercel URL
    unsub_link = f"{request.url_root}unsubscribe/{clean}?token={token}"
    unsub_text = "להסרה:"

    final_msg = f"{message}\n\n{unsub_text} {unsub_link}"

    # 3. Send SMS
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
    # 1. GET TOKEN
    token = request.args.get('token')
    if not token:
        abort(403, "Missing Token")

    # 2. RESTORE FORMAT (+972...) to verify signature
    # We passed cleaned phone in URL, so we might need to fix it or just check both formats
    # Let's try to match what generate_secure_token expects.
    # If logic above used 'phone' (which is +972...), we must reconstruct it.

    # Try 1: Assume input is "97250..." -> Make it "+97250..."
    candidate_phone = "+" + phone if not phone.startswith('+') else phone

    if not verify_token(candidate_phone, token):
        # Try 2: Maybe we signed the clean version? (Check broadcast logic)
        # Broadcast logic: token = generate_secure_token(phone) -> Phone from DB has +
        # So we MUST have the + to verify.
        if not verify_token(phone, token):  # Just in case
            abort(403, "Invalid Signature - Link Broken or Tampered")

    # 3. IF VALID, UNSUBSCRIBE
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

    return render_template_string(HTML_BASE, title="הוסרת",
                                  content="<h2 class='success'>הוסרת בהצלחה</h2><p>לא תקבל יותר הודעות מאיתנו.</p>")


@app.route('/admin/toggle')
def toggle_status():
    if not session.get('logged_in'): return redirect('/login')

    # Get params safely from query string
    phone = request.args.get('phone')
    action = request.args.get('action')

    if not phone or not action:
        return redirect('/admin')

    # Ensure phone has + (Browsers sometimes strip it from query params too, but less often)
    # If phone is "97250...", make it "+97250..."
    clean_phone = phone.strip()
    if not clean_phone.startswith('+') and clean_phone.startswith('972'):
        clean_phone = '+' + clean_phone
    elif not clean_phone.startswith('+'):
        # Fallback: assuming it's just missing the plus
        clean_phone = '+' + clean_phone.lstrip()

    new_status = 1 if action == 'unblock' else 0
    new_status_pg = "TRUE" if action == 'unblock' else "FALSE"

    conn, db_type = get_db()
    try:
        if db_type == "sqlite":
            conn.execute("UPDATE customers SET active=? WHERE phone=?", (new_status, clean_phone))
        else:
            cur = conn.cursor()
            # Postgres needs boolean literal or proper casting
            pg_bool = True if action == 'unblock' else False
            cur.execute("UPDATE customers SET active=%s WHERE phone=%s", (pg_bool, clean_phone))
            cur.close()
        conn.commit()
    except Exception as e:
        print(f"Error toggling {clean_phone}: {e}")
    finally:
        conn.close()

    return redirect('/admin')


@app.route('/debug-db')
def debug_db():
    try:
        # 1. Print Environment Variables (Safe version - hiding passwords)
        url = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
        if not url:
            return "ERROR: No DATABASE_URL or POSTGRES_URL found in env vars!"

        safe_url = url.split(":")[0] + "://...@" + url.split("@")[-1]

        # 2. Try Connecting
        import psycopg2
        if "sslmode" not in url: url += "?sslmode=require"
        conn = psycopg2.connect(url)
        cur = conn.cursor()

        # 3. Try Creating Table
        cur.execute("CREATE TABLE IF NOT EXISTS test_table (id SERIAL PRIMARY KEY);")
        conn.commit()
        conn.close()

        return f"✅ SUCCESS! Connected to: {safe_url}"
    except Exception as e:
        return f"❌ FAILED: {str(e)}"


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)
