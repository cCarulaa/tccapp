# ============================================================
# app.py - API do Almoxarifado (Flask + MySQL)
# É o "back-end": o aplicativo (App.tsx) não acessa o banco de
# dados direto, ele pede tudo a esta API. Assim a senha do banco
# fica só no servidor e as regras (quem pode o quê) ficam em um
# lugar único.
# ============================================================
import os
import secrets
from functools import wraps

import bcrypt                  # criptografa e confere senhas
import mysql.connector         # conexão com o banco MySQL
from flask import Flask, jsonify, request, g
from flask_cors import CORS    # permite que o app/navegador chame esta API

app = Flask(__name__)
CORS(app)

# Para este projeto simples, os tokens ficam guardados na memória.
# Cada login gera um token e este dicionário diz de quem ele é.
# Vantagem: não precisa de tabela nem biblioteca extra. Desvantagem:
# ao reiniciar o servidor, todo mundo precisa logar de novo.
tokens = {}


# Abre uma conexão nova com o MySQL.
# Os dados vêm de variáveis de ambiente (os valores depois da vírgula
# são o padrão para desenvolvimento), para não deixar senhas "fixas"
# no código quando o projeto for para outro computador.
def conectar():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", "root"),
        database=os.getenv("DB_NAME", "login"),
    )


# Monta uma resposta de sucesso no formato padrão
# {success, message, data}. Padronizar facilita o app: ele sempre
# lê "data" quando deu certo.
def resposta(data=None, message="OK", status=200):
    return jsonify({
        "success": True,
        "message": message,
        "data": data
    }), status


# Resposta de erro no mesmo padrão. O app mostra "message" no Alert.
def erro(message, status=400):
    return jsonify({
        "success": False,
        "message": message
    }), status


# Executa um SELECT e devolve os resultados.
# - uma=True devolve só uma linha; False devolve a lista toda.
# - dictionary=True devolve cada linha como dicionário (campo -> valor),
#   que já vira JSON direto.
# O "finally" garante que a conexão sempre é fechada, mesmo com erro,
# evitando acumular conexões abertas no MySQL.
# Os %s com "valores" são consultas parametrizadas: protegem contra
# SQL Injection (nunca juntamos texto do usuário dentro do SQL).
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


# Executa INSERT, UPDATE ou DELETE. O commit() grava a alteração de
# verdade no banco. Devolve o id criado (lastrowid), útil depois de
# um INSERT para buscar o registro novo.
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


# Descobre quem está fazendo a requisição. O app envia o token no
# cabeçalho "Authorization: Bearer <token>"; aqui tiramos o
# "Bearer " e procuramos o token no dicionário. Se não achar, devolve
# None (ninguém logado).
def usuario_atual():
    cabecalho = request.headers.get("Authorization", "")
    token = cabecalho.replace("Bearer ", "")
    return tokens.get(token)


# Decorador que protege as rotas: coloque @precisa_login() em cima
# de uma rota e ela só funciona para quem está logado;
# @precisa_login(admin=True) exige também ser administrador.
# Por que um decorador: a verificação fica escrita uma vez só, em vez
# de repetida dentro de cada rota. O usuário é guardado em "g" para a
# rota usar depois (ex.: registrar quem fez a movimentação).
# Códigos HTTP: 401 = não logado, 403 = sem permissão.
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


# O MySQL devolve o preço como Decimal, que o JSON não consegue
# converter. Aqui transformamos em float antes de responder.
def produto_json(produto):
    if not produto:
        return None
    produto["preco"] = float(produto["preco"])
    return produto


# Busca um produto pelo id (ou None se não existir). Usada em várias
# rotas para não repetir o mesmo SELECT.
def ler_produto(id_produto):
    return buscar(
        "SELECT * FROM produtos WHERE id = %s",
        (id_produto,),
        uma=True
    )


# Confere e limpa os dados de um produto antes de gravar no banco.
# Serve tanto para cadastrar quanto para editar. Se algo estiver
# errado, levanta ValueError com a mensagem; a rota captura e devolve
# o erro ao app. O servidor valida mesmo que o app já valide, porque
# nunca se deve confiar só no que vem de fora.
def validar_produto(dados):
    nome = str(dados.get("nome", "")).strip()
    categoria = str(dados.get("categoria", "")).strip()

    if not nome or not categoria:
        raise ValueError("Preencha o nome e a categoria.")

    try:
        quantidade = int(dados.get("quantidade", 0))
        minimo = int(dados.get("estoque_minimo", 0))
        # replace aceita preço digitado com vírgula (1,50)
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


# Rota raiz: confirma que a API está no ar. Útil para testar no
# navegador se o servidor e o IP estão corretos.
@app.get("/")
def inicio():
    return resposta({"api": "Almoxarifado", "online": True})


# Verifica também a conexão com o MySQL (um SELECT 1 simples).
# Ajuda a descobrir se um problema é do Flask ou do banco.
@app.get("/api/health")
def health():
    try:
        buscar("SELECT 1", uma=True)
        return resposta({"message": "Flask e MySQL funcionando"})
    except Exception as e:
        return erro("API iniciou, mas houve erro no MySQL: " + str(e), 500)


# Login. Responde em dois endereços (/api/login e /api/auth/login)
# para aceitar chamadas dos dois estilos usados no projeto.
# Passos: valida os campos, busca o usuário pelo e-mail, confere a
# senha com bcrypt e gera um token aleatório (secrets, que é seguro).
# A mensagem de erro é a mesma para e-mail errado e senha errada,
# para não revelar quais e-mails existem.
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

    # No banco a senha está guardada como hash (nunca em texto
    # puro); o bcrypt compara a digitada com o hash. O try evita
    # quebrar caso o valor salvo não seja um hash válido.
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
    # Guardamos só o necessário; a senha nunca sai daqui.
    dados_usuario = {
        "id": usuario["id"],
        "email": usuario["email"],
        "tipo": usuario["tipo"]
    }
    tokens[token] = dados_usuario

    return resposta({"token": token, "user": dados_usuario}, "Login realizado.")


# Cria uma conta nova. Sempre entra como tipo "usuario" (nunca admin),
# para ninguém se promover sozinho. A senha é transformada em hash
# com bcrypt (gensalt gera um "tempero" aleatório). Se o e-mail já
# existir, o MySQL dispara IntegrityError e respondemos 409
# (conflito).
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


# Logout: apaga o token da memória, então ele deixa de valer.
# O pop com None não dá erro se o token já não existir.
@app.post("/api/auth/logout")
@precisa_login()
def logout():
    cabecalho = request.headers.get("Authorization", "")
    token = cabecalho.replace("Bearer ", "")
    tokens.pop(token, None)
    return resposta(message="Logout realizado.")


# Devolve os dados de quem está logado. Serve para o app conferir
# se o token ainda é válido.
@app.get("/api/auth/me")
@precisa_login()
def me():
    return resposta(g.usuario)


# Lista todos os produtos, em ordem alfabética (ORDER BY nome).
# Qualquer usuário logado pode ver.
@app.get("/api/produtos")
@precisa_login()
def listar_produtos():
    produtos = buscar("SELECT * FROM produtos ORDER BY nome")
    return resposta([produto_json(p) for p in produtos])


# Mostra um único produto. <int:id_produto> já garante que o id da
# URL é um número. 404 = não encontrado.
@app.get("/api/produtos/<int:id_produto>")
@precisa_login()
def ver_produto(id_produto):
    produto = ler_produto(id_produto)
    if not produto:
        return erro("Produto não encontrado.", 404)
    return resposta(produto_json(produto))


# Cadastra produto (só admin). Valida os dados, insere no banco e
# devolve o produto criado com status 201 (criado).
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


# Edita produto (só admin). Guardamos o produto "antigo" antes de
# atualizar para comparar a quantidade: se o estoque mudou pela
# edição, registramos uma movimentação do tipo "Edição", assim o
# histórico não perde essa alteração.
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


# Exclui produto (só admin). Se o produto já tem movimentações, o
# banco recusa (chave estrangeira) e respondemos 409 com uma
# explicação, em vez de apagar o histórico.
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


# Função comum de entrada e retirada de estoque.
# Usa TRANSAÇÃO: atualizar a quantidade e registrar a movimentação
# precisam acontecer juntas; se uma falhar, o rollback desfaz tudo.
# O "FOR UPDATE" trava a linha do produto enquanto calculamos, para
# duas retiradas ao mesmo tempo não passarem do estoque disponível.
# Retirada maior que o estoque é recusada.
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


# Entrada de estoque (só admin). Valida a quantidade (inteiro maior
# que zero) e chama a função comum com o tipo "Entrada".
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


# Retirada de estoque (qualquer usuário logado). Mesma validação;
# usa o tipo "Retirada". A permissão é diferente da entrada porque
# funcionários comuns precisam pegar material no dia a dia.
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


# Histórico de movimentações. O JOIN junta as tabelas para devolver o
# nome do produto e o e-mail do usuário (e não só os ids), e o
# DATE_FORMAT entrega a data como texto simples. O ORDER BY mostra as
# mais recentes primeiro.
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


# Lista os usuários (só admin). Seleciona apenas id, e-mail e tipo,
# nunca a senha, mesmo ela sendo um hash.
@app.get("/api/usuarios")
@precisa_login(admin=True)
def listar_usuarios():
    usuarios = buscar("SELECT id, email, tipo FROM usuario ORDER BY email")
    return resposta(usuarios)


# Só roda quando o arquivo é executado direto (python app.py).
# host='0.0.0.0' deixa o celular da mesma rede acessar a API pelo IP
# do computador; debug=True recarrega sozinho ao editar o código e
# mostra erros detalhados (use só em desenvolvimento).
if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=True)
