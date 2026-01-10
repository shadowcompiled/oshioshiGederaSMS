import random
import os
import requests
import sqlite3
import re
import logging
import hmac
import hashlib
import csv
import io
from flask import Flask, request, render_template_string, jsonify, session, redirect, url_for, abort, send_file
from urllib.parse import urlparse
from dotenv import load_dotenv
from datetime import datetime

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

@app.route('/force-init')
def force_init():
    try:
        conn, db_type = get_db()
        if db_type == "postgres":
            cur = conn.cursor()
            cur.execute('DROP TABLE IF EXISTS customers CASCADE;')
            cur.execute('''
                CREATE TABLE customers (
                    phone TEXT PRIMARY KEY,
                    name TEXT,
                    email TEXT,
                    date_of_birth TEXT,
                    wedding_day TEXT,
                    city TEXT,
                    active BOOLEAN DEFAULT TRUE
                );
            ''')
            cur.close()
        else:
            conn.execute('DROP TABLE IF EXISTS customers;')
            conn.execute('''
                CREATE TABLE customers (
                    phone TEXT PRIMARY KEY,
                    name TEXT,
                    email TEXT,
                    date_of_birth TEXT,
                    wedding_day TEXT,
                    city TEXT,
                    active BOOLEAN DEFAULT 1
                );
            ''')
        conn.commit()
        conn.close()
        return "✅ Table 'customers' created successfully!"
    except Exception as e:
        return f"❌ Error: {e}"

def init_db():
    try:
        conn, db_type = get_db()
        schema = '''
            CREATE TABLE IF NOT EXISTS customers (
                phone TEXT PRIMARY KEY,
                name TEXT,
                email TEXT,
                date_of_birth TEXT,
                wedding_day TEXT,
                city TEXT,
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
<html lang="he" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>{{ title }}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        @keyframes slideShow {
            0% { background-image: url('/static/bg1.png'); }
            20% { background-image: url('/static/bg2.png'); }
            40% { background-image: url('/static/bg3.jpg'); }
            60% { background-image: url('/static/bg4.png'); }
            80% { background-image: url('/static/bg5.png'); }
            100% { background-image: url('/static/bg1.png'); }
        }

        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
            margin: 0; 
            padding: 0;
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
            padding: 16px;
        }

        body::before {
            content: "";
            position: fixed; 
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: -1;
        }

        .container {
            z-index: 1;
            background: rgba(255, 255, 255, 0.98);
            padding: 24px; 
            border-radius: 20px; 
            width: 100%; 
            max-width: 500px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
        }

        h2 { 
            color: #d32f2f; 
            margin-bottom: 8px; 
            font-size: 24px;
            font-weight: 700;
        }

        p { 
            color: #666; 
            margin-bottom: 16px; 
            font-size: 14px;
            line-height: 1.5;
        }

        .logo-area { 
            font-size: 48px; 
            margin-bottom: 12px; 
        }

        .form-group {
            margin-bottom: 14px;
            text-align: right;
        }

        label {
            display: block;
            font-size: 12px;
            color: #333;
            margin-bottom: 4px;
            font-weight: 600;
            text-align: right;
        }

        input, textarea, select { 
            width: 100%; 
            padding: 12px; 
            border: 2px solid #e0e0e0; 
            border-radius: 8px; 
            box-sizing: border-box; 
            font-size: 16px;
            text-align: right;
            font-family: inherit;
            direction: rtl;
        }

        input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: #d32f2f;
            box-shadow: 0 0 0 3px rgba(211,47,47,0.1);
        }

        textarea { 
            resize: vertical;
            min-height: 80px;
        }

        button { 
            background: #d32f2f; 
            color: white; 
            border: none; 
            padding: 14px; 
            width: 100%; 
            border-radius: 8px; 
            font-size: 16px; 
            font-weight: 700;
            cursor: pointer; 
            margin-top: 12px;
            transition: background 0.3s;
        }

        button:hover { 
            background: #b71c1c; 
        }

        button:active {
            transform: scale(0.98);
        }

        .success { 
            color: #2e7d32; 
            font-weight: 700;
            font-size: 16px;
        }

        .error { 
            color: #d32f2f;
            font-weight: 700;
        }

        a {
            color: #1976d2;
            text-decoration: none;
            font-size: 14px;
        }

        a:hover {
            text-decoration: underline;
        }

        .small-text {
            font-size: 12px;
            color: #999;
            margin-top: 12px;
            display: block;
        }
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
            <div class="form-group">
                <label for="name">שם מלא *</label>
                <input type="text" id="name" name="name" placeholder="שמך" required maxlength="100">
            </div>
            <div class="form-group">
                <label for="phone">טלפון *</label>
                <input type="tel" id="phone" name="phone" placeholder="050-1234567" required maxlength="20">
            </div>
            <div class="form-group">
                <label for="email">דוא"ל</label>
                <input type="email" id="email" name="email" placeholder="example@email.com">
            </div>
            <div class="form-group">
                <label for="dob">תאריך לידה</label>
                <input type="date" id="dob" name="date_of_birth">
            </div>
            <div class="form-group">
                <label for="wedding">יום חתונה</label>
                <input type="date" id="wedding" name="wedding_day">
            </div>
            <div class="form-group">
                <label for="city">עיר</label>
                <input type="text" id="city" name="city" placeholder="גדרה" maxlength="50">
            </div>
            <button type="submit">הצטרף למועדון</button>
        </form>
        <span class="small-text"><a href="/login">כניסת מנהל</a></span>
    """
    return render_template_string(HTML_BASE, title="Sushi VIP", content=content)


@app.route('/submit', methods=['POST'])
def submit():
    name = request.form.get('name', '').strip()
    raw_phone = request.form.get('phone', '').strip()
    email = request.form.get('email', '').strip()
    dob = request.form.get('date_of_birth', '').strip()
    wedding = request.form.get('wedding_day', '').strip()
    city = request.form.get('city', '').strip()

    phone = format_phone(raw_phone)

    if len(phone) < 10 or not phone.startswith('+'):
        return render_template_string(HTML_BASE, title="שגיאה",
                                      content="<h3 class='error'>מספר טלפון לא תקין</h3><a href='/'>חזור</a>")

    try:
        conn, db_type = get_db()
        q_sql = '''INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active) 
                   VALUES (?, ?, ?, ?, ?, ?, 1) 
                   ON CONFLICT(phone) DO UPDATE SET active=1, name=excluded.name, email=excluded.email, 
                   date_of_birth=excluded.date_of_birth, wedding_day=excluded.wedding_day, city=excluded.city'''
        q_pg = '''INSERT INTO customers (phone, name, email, date_of_birth, wedding_day, city, active) 
                  VALUES (%s, %s, %s, %s, %s, %s, TRUE) 
                  ON CONFLICT(phone) DO UPDATE SET active=TRUE, name=EXCLUDED.name, email=EXCLUDED.email,
                  date_of_birth=EXCLUDED.date_of_birth, wedding_day=EXCLUDED.wedding_day, city=EXCLUDED.city'''

        if db_type == "sqlite":
            conn.execute(q_sql, (phone, name, email, dob, wedding, city))
        else:
            cur = conn.cursor()
            cur.execute(q_pg, (phone, name, email, dob, wedding, city))
            cur.close()
        conn.commit()
    except Exception as e:
        logger.error(f"Submit Error: {e}")
        return render_template_string(HTML_BASE, title="שגיאה", content="<h3 class='error'>תקלה במערכת</h3>")
    finally:
        if 'conn' in locals(): conn.close()

    return render_template_string(HTML_BASE, title="תודה",
                                  content="<h2 class='success'>✅ נרשמת בהצלחה!</h2><a href='/'>חזור</a>")


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('password') == ADMIN_PASSWORD:
            session['logged_in'] = True
            return redirect('/admin')
        return render_template_string(HTML_BASE, title="Login",
                                      content="<h2>שגיאה</h2><p>סיסמה שגויה</p><a href='/login'>נסה שוב</a>")

    content = """
    <h2>כניסת מנהל</h2>
    <form method="POST">
        <div class="form-group">
            <input type="password" name="password" placeholder="סיסמה" required>
        </div>
        <button type="submit">כניסה</button>
    </form>
    """
    return render_template_string(HTML_BASE, title="Login", content=content)


@app.route('/admin')
def admin():
    if not session.get('logged_in'): return redirect('/login')

    conn, db_type = get_db()
    try:
        q = "SELECT phone, name, email, date_of_birth, wedding_day, city, active FROM customers ORDER BY active DESC, name ASC"
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

    active_count = sum(1 for r in rows if r[6])
    msg = request.args.get('msg', '')

    table_rows = ""
    for r in rows:
        phone = r[0]
        status = '<span class="success">פעיל</span>' if r[6] else '<span class="error">הוסר</span>'

        if r[6]:
            link = url_for('toggle_status', phone=phone, action='block')
            action_btn = f'<a href="{link}" style="font-size:12px;">⛔ חסימה</a>'
        else:
            link = url_for('toggle_status', phone=phone, action='unblock')
            action_btn = f'<a href="{link}" style="font-size:12px;">✅ שחזור</a>'

        table_rows += f"""
           <tr style="border-bottom: 1px solid #eee;">
               <td style="padding:10px; text-align:right;">{r[1]}</td>
               <td style="padding:10px; text-align:right; font-size:12px;">{r[2] or '-'}</td>
               <td style="padding:10px; text-align:right; font-size:12px; direction:ltr;">{phone}</td>
               <td style="padding:10px; text-align:center; font-size:12px;">{r[3] or '-'}</td>
               <td style="padding:10px; text-align:center; font-size:12px;">{r[4] or '-'}</td>
               <td style="padding:10px; text-align:right; font-size:12px;">{r[5] or '-'}</td>
               <td style="padding:10px; text-align:center;">{status}</td>
               <td style="padding:10px; text-align:center;">{action_btn}</td>
           </tr>
           """

    admin_html = f"""
    <div style="direction:rtl; text-align:right;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
            <h2 style="margin:0; flex:1;">ניהול לקוחות 🍣</h2>
            <a href="/admin/export-csv" style="background:#4CAF50; color:white; padding:8px 12px; border-radius:4px; text-decoration:none; font-size:14px; font-weight:600;">📊 ייצוא CSV</a>
            <a href="/logout" style="background:#333; color:white; padding:8px 12px; border-radius:4px; text-decoration:none; font-size:14px;">יציאה</a>
        </div>

        <div style="background:#fff; padding:20px; border:1px solid #eee; border-radius:8px; margin-bottom:20px;">
            <h3 style="margin-top:0;">📢 שליחת הודעה ({active_count} פעילים)</h3>
            <form action="/admin/broadcast" method="POST" onsubmit="return confirm('לשלוח לכולם?');">
                <textarea name="message" placeholder="הקלד הודעה כאן..." required style="height:100px; margin-bottom:10px;"></textarea>
                <div style="margin-top:5px; font-size:12px; color:gray;">* קישור הסרה יתווסף אוטומטית</div>
                <button type="submit" style="margin-top:10px;">🚀 שלח הודעה</button>
            </form>
            <p style="color:blue; font-weight:bold; margin-top:10px;">{msg}</p>
        </div>

        <h3 style="border-bottom:2px solid #d32f2f; padding-bottom:5px; display:inline-block; margin-bottom:15px;">רשימת לקוחות ({len(rows)})</h3>
        <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
                <thead style="background:#f5f5f5; position:sticky; top:0;">
                    <tr style="border-bottom:2px solid #d32f2f;">
                        <th style="padding:10px; text-align:right;">שם</th>
                        <th style="padding:10px; text-align:right;">דוא"ל</th>
                        <th style="padding:10px; text-align:right;">טלפון</th>
                        <th style="padding:10px; text-align:center;">תאריך לידה</th>
                        <th style="padding:10px; text-align:center;">יום חתונה</th>
                        <th style="padding:10px; text-align:right;">עיר</th>
                        <th style="padding:10px; text-align:center;">סטטוס</th>
                        <th style="padding:10px; text-align:center;">פעולה</th>
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


# --- EXPORT CSV ---
@app.route('/admin/export-csv')
def export_csv():
    if not session.get('logged_in'): return redirect('/login')

    conn, db_type = get_db()
    try:
        q = "SELECT phone, name, email, date_of_birth, wedding_day, city, active FROM customers ORDER BY name ASC"
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

    # Create CSV in memory
    output = io.StringIO()
    writer = csv.writer(output, lineterminator='\n')

    # Header
    writer.writerow(['שם', 'טלפון', 'דוא"ל', 'תאריך לידה', 'יום חתונה', 'עיר', 'סטטוס'])

    # Data
    for r in rows:
        status = 'פעיל' if r[6] else 'הוסר'
        writer.writerow([r[1], r[0], r[2] or '', r[3] or '', r[4] or '', r[5] or '', status])

    # Convert to bytes
    output.seek(0)
    mem = io.BytesIO()
    mem.write(output.getvalue().encode('utf-8-sig'))  # UTF-8 with BOM for Excel
    mem.seek(0)

    return send_file(
        mem,
        mimetype='text/csv; charset=utf-8',
        as_attachment=True,
        download_name=f'customers_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
    )


# --- BROADCAST ---
@app.route('/admin/broadcast', methods=['POST'])
def broadcast():
    if not session.get('logged_in'): return redirect('/login')

    message = request.form.get('message')
    if not message: return redirect('/admin')

    conn, db_type = get_db()
    try:
        q = "SELECT phone FROM customers WHERE active=TRUE" if db_type == "postgres" else "SELECT phone FROM customers WHERE active=1"
        if db_type == "postgres":
            cur = conn.cursor()
            cur.execute(q)
            recipients = cur.fetchall()
        else:
            recipients = conn.execute(q).fetchall()
    finally:
        conn.close()

    qstash_token = os.environ.get("QSTASH_TOKEN")
    base_url = "https://oshioshi-gedera-sms.vercel.app"
    target_endpoint = f"{base_url}/api/send_sms_task"

    if qstash_token:
        headers = {
            "Authorization": f"Bearer {qstash_token}",
            "Content-Type": "application/json"
        }

        count = 0
        for row in recipients:
            phone = row[0]
            try:
                requests.post(
                    f"https://qstash.upstash.io/v2/publish/{target_endpoint}",
                    headers=headers,
                    json={
                        "phone": phone,
                        "message": message,
                        "secret": app.secret_key
                    },
                    timeout=5
                )
                count += 1
            except Exception as e:
                print(f"Failed to queue {phone}: {e}")

        return redirect(url_for('admin', msg=f"ההודעות נשלחו לתור (נשלח ל-{count} לקוחות)"))
    else:
        return redirect(url_for('admin', msg="שגיאה: חסר QSTASH_TOKEN"))


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

    return render_template_string(HTML_BASE, title="הוסרת",
                                  content="<h2 class='success'>הוסרת בהצלחה</h2><p>לא תקבל יותר הודעות מאיתנו.</p>")


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


@app.route('/logout')
def logout():
    session.clear()
    return redirect('/')


if __name__ == '__main__':
    init_db()
    app.run(host='0.0.0.0', port=5000, debug=True)
