import os
import secrets
from functools import wraps

import bcrypt
import mysql.connector
from flask import Flask, jsonify, request, g
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Para este projeto simples, os tokens ficam guardados na memória.
tokens = {}


def conectar():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", "root"),
        database=os.getenv("DB_NAME", "login"),
    )


def resposta(data=None, message="OK", status=200):
    return jsonify({
        "success": True,
        "message": message,
        "data": data
    }), status


def erro(message, status=400):
    return jsonify({
        "success": False,
        "message": message
    }), status


def buscar(sql, valores=(), uma=False):
    con = conectar()
    cur = con.cursor(dictionary=True)
    try:
        cur.execute(sql, valores)
        if uma:
            return cur.fetchone()
        return cur.fetchall()
    finally:
        cur.close()
        con.close()


def executar(sql, valores=()):
    con = conectar()
    cur = con.cursor()
    try:
        cur.execute(sql, valores)
        con.commit()
        return cur.lastrowid
    finally:
        cur.close()
        con.close()


def usuario_atual():
    cabecalho = request.headers.get("Authorization", "")
    token = cabecalho.replace("Bearer ", "")
    return tokens.get(token)


def precisa_login(admin=False):
    def decorador(funcao):
        @wraps(funcao)
        def verificar(*args, **kwargs):
            usuario = usuario_atual()

            if not usuario:
                return erro("Faça login para continuar.", 401)

            if admin and usuario["tipo"] != "admin":
                return erro("Somente administradores podem fazer isso.", 403)

            g.usuario = usuario
            return funcao(*args, **kwargs)
        return verificar
    return decorador


def produto_json(produto):
    if not produto:
        return None
    produto["preco"] = float(produto["preco"])
    return produto


def ler_produto(id_produto):
    return buscar(
        "SELECT * FROM produtos WHERE id = %s",
        (id_produto,),
        uma=True
    )


def validar_produto(dados):
    nome = str(dados.get("nome", "")).strip()
    categoria = str(dados.get("categoria", "")).strip()

    if not nome or not categoria:
        raise ValueError("Preencha o nome e a categoria.")

    try:
        quantidade = int(dados.get("quantidade", 0))
        minimo = int(dados.get("estoque_minimo", 0))
        preco = float(str(dados.get("preco", 0)).replace(",", "."))
    except (ValueError, TypeError):
        raise ValueError("Quantidade, estoque mínimo ou preço inválido.")

    if quantidade < 0 or minimo < 0 or preco < 0:
        raise ValueError("Os valores não podem ser negativos.")

    return {
        "nome": nome,
        "categoria": categoria,
        "quantidade": quantidade,
        "estoque_minimo": minimo,
        "preco": preco,
        "foto": dados.get("foto") or None,
    }


@app.get("/")
def inicio():
    return resposta({"api": "Almoxarifado", "online": True})


@app.get("/api/health")
def health():
    try:
        buscar("SELECT 1", uma=True)
        return resposta({"message": "Flask e MySQL funcionando"})
    except Exception as e:
        return erro("API iniciou, mas houve erro no MySQL: " + str(e), 500)


@app.post("/api/login")
@app.post("/api/auth/login")
def login():
    dados = request.get_json(silent=True) or {}
    email = str(dados.get("email", "")).strip().lower()
    senha = str(dados.get("senha", ""))

    if not email or not senha:
        return erro("Preencha e-mail e senha.")

    usuario = buscar(
        "SELECT id, email, senha, tipo FROM usuario WHERE email = %s",
        (email,),
        uma=True
    )

    if not usuario:
        return erro("E-mail ou senha incorretos.", 401)

    try:
        senha_certa = bcrypt.checkpw(
            senha.encode("utf-8"),
            usuario["senha"].encode("utf-8")
        )
    except Exception:
        senha_certa = False

    if not senha_certa:
        return erro("E-mail ou senha incorretos.", 401)

    token = secrets.token_hex(24)
    dados_usuario = {
        "id": usuario["id"],
        "email": usuario["email"],
        "tipo": usuario["tipo"]
    }
    tokens[token] = dados_usuario

    return resposta({"token": token, "user": dados_usuario}, "Login realizado.")


@app.post("/api/register")
@app.post("/api/auth/register")
def registrar():
    dados = request.get_json(silent=True) or {}
    email = str(dados.get("email", "")).strip().lower()
    senha = str(dados.get("senha", ""))

    if not email or not senha:
        return erro("Preencha e-mail e senha.")

    if len(senha) < 6:
        return erro("A senha precisa ter pelo menos 6 caracteres.")

    senha_hash = bcrypt.hashpw(
        senha.encode("utf-8"),
        bcrypt.gensalt()
    ).decode("utf-8")

    try:
        executar(
            "INSERT INTO usuario (email, senha, tipo) VALUES (%s, %s, 'usuario')",
            (email, senha_hash)
        )
        return resposta(message="Usuário criado com sucesso.", status=201)
    except mysql.connector.IntegrityError:
        return erro("Esse e-mail já está cadastrado.", 409)
    except Exception as e:
        return erro("Erro ao criar usuário: " + str(e), 500)


@app.post("/api/auth/logout")
@precisa_login()
def logout():
    cabecalho = request.headers.get("Authorization", "")
    token = cabecalho.replace("Bearer ", "")
    tokens.pop(token, None)
    return resposta(message="Logout realizado.")


@app.get("/api/auth/me")
@precisa_login()
def me():
    return resposta(g.usuario)


@app.get("/api/produtos")
@precisa_login()
def listar_produtos():
    produtos = buscar("SELECT * FROM produtos ORDER BY nome")
    return resposta([produto_json(p) for p in produtos])


@app.get("/api/produtos/<int:id_produto>")
@precisa_login()
def ver_produto(id_produto):
    produto = ler_produto(id_produto)
    if not produto:
        return erro("Produto não encontrado.", 404)
    return resposta(produto_json(produto))


@app.post("/api/produtos")
@precisa_login(admin=True)
def adicionar_produto():
    try:
        p = validar_produto(request.get_json(silent=True) or {})
        novo_id = executar(
            """INSERT INTO produtos
               (nome, categoria, quantidade, estoque_minimo, preco, foto)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (p["nome"], p["categoria"], p["quantidade"],
             p["estoque_minimo"], p["preco"], p["foto"])
        )
        produto = ler_produto(novo_id)
        return resposta(produto_json(produto), "Produto adicionado.", 201)
    except ValueError as e:
        return erro(str(e))


@app.put("/api/produtos/<int:id_produto>")
@precisa_login(admin=True)
def editar_produto(id_produto):
    antigo = ler_produto(id_produto)
    if not antigo:
        return erro("Produto não encontrado.", 404)

    try:
        p = validar_produto(request.get_json(silent=True) or {})
        executar(
            """UPDATE produtos SET
               nome=%s, categoria=%s, quantidade=%s,
               estoque_minimo=%s, preco=%s, foto=%s
               WHERE id=%s""",
            (p["nome"], p["categoria"], p["quantidade"],
             p["estoque_minimo"], p["preco"], p["foto"], id_produto)
        )

        diferenca = abs(p["quantidade"] - antigo["quantidade"])
        if diferenca > 0:
            executar(
                """INSERT INTO movimentacoes
                   (produto_id, usuario_id, quantidade, tipo)
                   VALUES (%s, %s, %s, 'Edição')""",
                (id_produto, g.usuario["id"], diferenca)
            )

        return resposta(message="Produto editado.")
    except ValueError as e:
        return erro(str(e))


@app.delete("/api/produtos/<int:id_produto>")
@precisa_login(admin=True)
def excluir_produto(id_produto):
    if not ler_produto(id_produto):
        return erro("Produto não encontrado.", 404)

    try:
        executar("DELETE FROM produtos WHERE id=%s", (id_produto,))
        return resposta(message="Produto excluído.")
    except mysql.connector.IntegrityError:
        return erro(
            "Não dá para excluir este produto porque ele já tem movimentações registradas.",
            409
        )


def mudar_estoque(id_produto, quantidade, tipo):
    con = conectar()
    cur = con.cursor(dictionary=True)
    try:
        con.start_transaction()
        cur.execute(
            "SELECT id, quantidade FROM produtos WHERE id=%s FOR UPDATE",
            (id_produto,)
        )
        produto = cur.fetchone()

        if not produto:
            con.rollback()
            return erro("Produto não encontrado.", 404)

        atual = produto["quantidade"]
        if tipo == "Retirada" and atual < quantidade:
            con.rollback()
            return erro("Estoque insuficiente.", 400)

        if tipo == "Entrada":
            novo_total = atual + quantidade
        else:
            novo_total = atual - quantidade

        cur.execute(
            "UPDATE produtos SET quantidade=%s WHERE id=%s",
            (novo_total, id_produto)
        )
        cur.execute(
            """INSERT INTO movimentacoes
               (produto_id, usuario_id, quantidade, tipo)
               VALUES (%s, %s, %s, %s)""",
            (id_produto, g.usuario["id"], quantidade, tipo)
        )
        con.commit()
        return resposta({"quantidade": novo_total}, "Estoque atualizado.")
    except Exception as e:
        con.rollback()
        return erro("Erro ao movimentar estoque: " + str(e), 500)
    finally:
        cur.close()
        con.close()


@app.post("/api/produtos/<int:id_produto>/adicionar")
@precisa_login(admin=True)
def entrada_estoque(id_produto):
    dados = request.get_json(silent=True) or {}
    try:
        quantidade = int(dados.get("quantidade", 0))
    except (ValueError, TypeError):
        return erro("Quantidade inválida.")
    if quantidade <= 0:
        return erro("A quantidade deve ser maior que zero.")
    return mudar_estoque(id_produto, quantidade, "Entrada")


@app.post("/api/produtos/<int:id_produto>/retirar")
@precisa_login()
def retirada_estoque(id_produto):
    dados = request.get_json(silent=True) or {}
    try:
        quantidade = int(dados.get("quantidade", 0))
    except (ValueError, TypeError):
        return erro("Quantidade inválida.")
    if quantidade <= 0:
        return erro("A quantidade deve ser maior que zero.")
    return mudar_estoque(id_produto, quantidade, "Retirada")


@app.get("/api/movimentacoes")
@precisa_login()
def listar_movimentacoes():
    movimentos = buscar(
        """SELECT m.id, m.produto_id, p.nome AS produto,
                  m.tipo, m.quantidade, u.email AS usuario,
                  DATE_FORMAT(m.data_hora, '%Y-%m-%d %H:%i:%s') AS data_hora
           FROM movimentacoes m
           JOIN produtos p ON p.id=m.produto_id
           JOIN usuario u ON u.id=m.usuario_id
           ORDER BY m.data_hora DESC, m.id DESC"""
    )
    return resposta(movimentos)


@app.get("/api/usuarios")
@precisa_login(admin=True)
def listar_usuarios():
    usuarios = buscar("SELECT id, email, tipo FROM usuario ORDER BY email")
    return resposta(usuarios)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
