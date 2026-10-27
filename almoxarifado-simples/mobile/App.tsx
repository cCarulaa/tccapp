import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Platform,
  Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TextInputProps, View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';

/* ===== cores (mesmas variáveis do style.css) ===== */
const C = {
  branco: '#fff',
  cinza: '#eef1f4',
  borda: '#ddd',
  azul: '#0d1860',
  azulEscuro: '#0d1860',
  laranja: '#f7941d',
  laranjaEscuro: '#dd7e08',
  texto: '#1a1a2e',
  label: '#555',
  input: '#ccc',
};

type User = {id:number; email:string; tipo:'admin'|'usuario'};
type Product = {
  id:number; nome:string; categoria:string; quantidade:number;
  estoque_minimo:number; preco:number; foto?:string;
};
type Movement = {
  id:number; produto:string; tipo:string; quantidade:number;
  usuario:string; data_hora:string;
};
type Pagina = 'produtos'|'novo'|'movimentos'|'usuarios';

async function api(path:string, options:any={}, token=''){
  const headers:any = {'Content-Type':'application/json'};
  if(token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(API + path, {...options, headers});
  const body = await res.json().catch(()=>({}));

  if(!res.ok) throw new Error(body.message || 'Erro na operação');
  return body.data;
}

/* ===================================================== */
/* App                                                   */
/* ===================================================== */

export default function App(){
  const [token,setToken] = useState('');
  const [user,setUser] = useState<User|null>(null);
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    async function abrir(){
      const t = await AsyncStorage.getItem('token');
      const u = await AsyncStorage.getItem('user');
      if(t && u){setToken(t);setUser(JSON.parse(u));}
      setLoading(false);
    }
    abrir();
  },[]);

  async function entrar(email:string,senha:string){
    const dados = await api('/auth/login',{
      method:'POST',
      body:JSON.stringify({email,senha})
    });
    await AsyncStorage.multiSet([
      ['token',dados.token],
      ['user',JSON.stringify(dados.user)]
    ]);
    setToken(dados.token);
    setUser(dados.user);
  }

  async function sair(){
    try{
      if(token) await api('/auth/logout',{method:'POST'},token);
    }catch{}
    await AsyncStorage.multiRemove(['token','user']);
    setToken('');
    setUser(null);
  }

  if(loading) return <View style={s.centro}><ActivityIndicator size="large" color={C.azul}/></View>;
  if(!token || !user) return <Login entrar={entrar}/>;
  return <Principal user={user} token={token} sair={sair}/>;
}

/* ===================================================== */
/* Login                                                 */
/* ===================================================== */

function Login({entrar}:{entrar:(e:string,s:string)=>Promise<void>}){
  const [email,setEmail] = useState('');
  const [senha,setSenha] = useState('');

  async function fazerLogin(){
    if(!email || !senha) return Alert.alert('Atenção','Preencha usuário e senha.');
    try{await entrar(email.trim(),senha);}
    catch(e:any){Alert.alert('Erro no login',e.message);}
  }

  return (
    <View style={s.loginTela}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent"/>
      <KeyboardAvoidingView
        style={{flex:1}}
        behavior={Platform.OS==='ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{flexGrow:1}}
          keyboardShouldPersistTaps="handled"
          bounces={false}>
          <Image source={require('./assets/fotologin.jpg')}
            style={s.loginFoto} resizeMode="cover"/>

          <View style={s.loginPainel}>
            <View style={s.authCard}>
              <Image source={require('./assets/logosenai.png')} style={s.authLogo} resizeMode="contain"/>
              <Text style={s.authTitulo}>Login</Text>

              <Campo label="Usuário" value={email} onChangeText={setEmail}
                autoCapitalize="none" keyboardType="email-address"/>
              <Campo label="Senha" value={senha} onChangeText={setSenha} secureTextEntry/>

              <Botao texto="Entrar" onPress={fazerLogin} cheio/>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ===================================================== */
/* Estrutura principal (navbar + páginas)                */
/* ===================================================== */

function Principal({user,token,sair}:{user:User;token:string;sair:()=>Promise<void>}){
  const admin = user.tipo==='admin';
  const [pagina,setPagina] = useState<Pagina>('produtos');
  const [editando,setEditando] = useState<Product|null>(null);
  const [produtos,setProdutos] = useState<Product[]>([]);
  const [movimentos,setMovimentos] = useState<Movement[]>([]);
  const [usuarios,setUsuarios] = useState<User[]>([]);

  async function carregar(){
    try{
      setProdutos((await api('/produtos',{},token)) || []);
      if(pagina==='movimentos')
        setMovimentos((await api('/movimentacoes',{},token)) || []);
      if(pagina==='usuarios' && admin)
        setUsuarios((await api('/usuarios',{},token)) || []);
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  useEffect(()=>{carregar();},[pagina]);

  function ir(p:Pagina){
    setEditando(null);
    setPagina(p);
  }

  function editar(p:Product){
    setEditando(p);
    setPagina('novo');
  }

  return (
    <View style={s.tela}>
      <StatusBar barStyle="light-content" backgroundColor={C.azul}/>

      {/* navbar */}
      <SafeAreaView style={s.navbar}>
        <View style={s.navbarTopo}>
          <Text style={s.navbarMarca}>Almoxarifado</Text>
          <Pressable style={[s.navBtn,{backgroundColor:C.laranja}]} onPress={sair}>
            <Text style={[s.navBtnTexto,{color:C.branco,fontWeight:'400'}]}>Sair</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.navbarLinks}>
          <NavBotao texto="Produtos" ativo={pagina==='produtos'} onPress={()=>ir('produtos')}/>
          {admin && <NavBotao texto="Novo Produto" ativo={pagina==='novo' && !editando} onPress={()=>ir('novo')}/>}
          <NavBotao texto="Movimentação" ativo={pagina==='movimentos'} onPress={()=>ir('movimentos')}/>
          {admin && <NavBotao texto="Usuários" ativo={pagina==='usuarios'} onPress={()=>ir('usuarios')}/>}
        </ScrollView>
      </SafeAreaView>

      <View style={{flex:1}}>
        {pagina==='produtos' &&
          <Produtos produtos={produtos} token={token} admin={admin}
            editar={editar} novo={()=>ir('novo')} atualizar={carregar}/>}
        {pagina==='novo' && admin &&
          <FormularioProduto token={token} produto={editando}
            voltar={()=>ir('produtos')} atualizar={carregar}/>}
        {pagina==='movimentos' &&
          <Movimentacoes dados={movimentos} produtos={produtos} token={token}
            admin={admin} atualizar={carregar}/>}
        {pagina==='usuarios' && admin &&
          <Usuarios dados={usuarios} token={token} atualizar={carregar}/>}
      </View>
    </View>
  );
}

/* ===================================================== */
/* Produtos                                              */
/* ===================================================== */

function Produtos({
  produtos,token,admin,editar,novo,atualizar
}:{
  produtos:Product[];token:string;admin:boolean;
  editar:(p:Product)=>void;novo:()=>void;atualizar:()=>void
}){
  return (
    <FlatList
      data={produtos}
      keyExtractor={p=>String(p.id)}
      contentContainerStyle={s.pagina}
      ListHeaderComponent={
        <View>
          <Cabecalho eyebrow="Estoque" titulo="Produtos cadastrados"/>
          {admin && <Botao texto="Novo Produto" onPress={novo}/>}
          <View style={{height:16}}/>
        </View>
      }
      ListEmptyComponent={
        <View style={s.painel}><Text style={s.textoBase}>Nenhum produto cadastrado.</Text></View>
      }
      renderItem={({item})=>
        <ProdutoCard produto={item} token={token} admin={admin}
          editar={()=>editar(item)} atualizar={atualizar}/>
      }
    />
  );
}

function ProdutoCard({
  produto,token,admin,editar,atualizar
}:{
  produto:Product;token:string;admin:boolean;editar:()=>void;atualizar:()=>void
}){
  const baixo = produto.estoque_minimo>0 && produto.quantidade<=produto.estoque_minimo;

  async function excluir(){
    try{
      await api(`/produtos/${produto.id}`,{method:'DELETE'},token);
      atualizar();
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <Text style={s.cardNome}>{produto.nome}</Text>
        <View style={s.pill}><Text style={s.pillTexto}>{produto.categoria}</Text></View>
      </View>

      <View style={s.cardCorpo}>
        {!!produto.foto &&
          <Image source={{uri:produto.foto}} style={s.thumb}/>}
        <View style={{flex:1}}>
          <Text style={s.cardLinha}>
            <Text style={s.cardRotulo}>Quantidade: </Text>{produto.quantidade}
          </Text>
          <Text style={s.cardLinha}>
            <Text style={s.cardRotulo}>Preço: </Text>R$ {Number(produto.preco||0).toFixed(2).replace('.',',')}
          </Text>
          {baixo && <Text style={s.alertaBaixo}>Estoque baixo (mínimo {produto.estoque_minimo})</Text>}
        </View>
      </View>

      {admin &&
        <View style={s.acoes}>
          <Botao texto="Editar" onPress={editar}/>
          <Botao texto="Excluir" tipo="laranja" onPress={()=>
            Alert.alert('Excluir produto?','',[
              {text:'Cancelar'},
              {text:'Excluir',style:'destructive',onPress:excluir}
            ])
          }/>
        </View>
      }
    </View>
  );
}

/* ===================================================== */
/* Novo item / editar                                    */
/* ===================================================== */

function FormularioProduto({
  token,produto,voltar,atualizar
}:{
  token:string;produto:Product|null;voltar:()=>void;atualizar:()=>void
}){
  const [nome,setNome] = useState(produto?.nome || '');
  const [categoria,setCategoria] = useState(produto?.categoria || '');
  const [quantidade,setQuantidade] = useState(produto ? String(produto.quantidade) : '');
  const [minimo,setMinimo] = useState(produto ? String(produto.estoque_minimo) : '');
  const [preco,setPreco] = useState(produto ? String(produto.preco) : '');
  const [foto,setFoto] = useState(produto?.foto || '');

  async function salvar(){
    if(!nome.trim() || !categoria.trim())
      return Alert.alert('Atenção','Preencha nome e categoria.');

    const dados = {
      nome:nome.trim(),categoria:categoria.trim(),
      quantidade:Number(quantidade||0),estoque_minimo:Number(minimo||0),
      preco:Number((preco||'0').replace(',','.')),foto:foto || null
    };

    try{
      await api(produto?`/produtos/${produto.id}`:'/produtos',{
        method:produto?'PUT':'POST',body:JSON.stringify(dados)
      },token);
      Alert.alert('Pronto',produto?'Item atualizado.':'Item cadastrado.');
      atualizar();
      voltar();
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  return (
    <ScrollView contentContainerStyle={s.pagina} keyboardShouldPersistTaps="handled">
      <Cabecalho eyebrow="Cadastro" titulo={produto?'Editar item':'Novo item'}/>

      <View style={s.formPanel}>
        <Campo label="Nome" value={nome} onChangeText={setNome}/>
        <Campo label="Categoria" value={categoria} onChangeText={setCategoria}/>
        <Campo label="Quantidade em estoque" value={quantidade}
          onChangeText={setQuantidade} keyboardType="number-pad"/>
        <Campo label="Estoque mínimo" value={minimo}
          onChangeText={setMinimo} keyboardType="number-pad"/>
        <Campo label="Preço" value={preco} onChangeText={setPreco}
          keyboardType="decimal-pad" placeholder="0,00"/>
        <Campo label="Foto (URL)" value={foto} onChangeText={setFoto}
          autoCapitalize="none" placeholder="https://..."/>

        <View style={s.actionRow}>
          <Botao texto="Voltar" tipo="contorno" onPress={voltar}/>
          <Botao texto="Salvar item" onPress={salvar}/>
        </View>
      </View>
    </ScrollView>
  );
}

/* ===================================================== */
/* Movimentação de estoque                               */
/* ===================================================== */

function Movimentacoes({
  dados,produtos,token,admin,atualizar
}:{
  dados:Movement[];produtos:Product[];token:string;admin:boolean;atualizar:()=>void
}){
  const [produtoId,setProdutoId] = useState('');
  const [qtd,setQtd] = useState('');
  const [destino,setDestino] = useState(admin ? 'adicionar' : 'retirar');
  const [finalidade,setFinalidade] = useState('');

  const destinos = admin
    ? [{valor:'adicionar',label:'Entrada'},{valor:'retirar',label:'Saída'}]
    : [{valor:'retirar',label:'Saída'}];

  async function registrar(){
    const n = Number(qtd);
    if(!produtoId) return Alert.alert('Atenção','Selecione um item.');
    if(!Number.isInteger(n) || n<=0) return Alert.alert('Atenção','Digite uma quantidade válida.');
    try{
      await api(`/produtos/${produtoId}/${destino}`,{
        method:'POST',
        body:JSON.stringify({quantidade:n,finalidade:finalidade.trim()})
      },token);
      setQtd('');
      setFinalidade('');
      atualizar();
      Alert.alert('Pronto','Movimentação registrada.');
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  return (
    <ScrollView contentContainerStyle={s.pagina} keyboardShouldPersistTaps="handled">
      <Cabecalho eyebrow="Entrada e saída" titulo="Movimentação de estoque"/>

      <View style={s.formPanel}>
        <Seletor label="Item" valor={produtoId} placeholder="Selecione"
          opcoes={produtos.map(p=>({valor:String(p.id),label:`${p.nome} (${p.quantidade})`}))}
          onChange={setProdutoId}/>
        <Campo label="Quantidade" value={qtd} onChangeText={setQtd} keyboardType="number-pad"/>
        <Seletor label="Destino" valor={destino} opcoes={destinos} onChange={setDestino}/>
        <Campo label="Finalidade ou uso" value={finalidade} onChangeText={setFinalidade}
          placeholder="Aula do professor, reposição..." multiline altura={110}/>
        <View style={s.actionRow}>
          <Botao texto="Registrar" onPress={registrar}/>
        </View>
      </View>

      <View style={s.painel}>
        <Text style={s.painelTitulo}>Últimas movimentações</Text>
        {dados.length===0 && <Text style={s.textoBase}>Nenhuma movimentação registrada.</Text>}
        {dados.map(m=>
          <View key={m.id} style={s.movItem}>
            <View style={s.cardHeader}>
              <Text style={s.cardNome}>{m.produto}</Text>
              <View style={s.pill}><Text style={s.pillTexto}>{m.tipo}</Text></View>
            </View>
            <Text style={s.cardLinha}><Text style={s.cardRotulo}>Quantidade: </Text>{m.quantidade}</Text>
            <Text style={s.cardLinha}><Text style={s.cardRotulo}>Usuário: </Text>{m.usuario}</Text>
            <Text style={s.cardLinha}><Text style={s.cardRotulo}>Data: </Text>{m.data_hora}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/* ===================================================== */
/* Usuários                                              */
/* ===================================================== */

function Usuarios({dados,token,atualizar}:{dados:User[];token:string;atualizar:()=>void}){
  const [email,setEmail] = useState('');
  const [senha,setSenha] = useState('');
  const [tipo,setTipo] = useState('admin');

  async function cadastrar(){
    if(!email.trim() || !senha) return Alert.alert('Atenção','Preencha usuário e senha.');
    try{
      await api('/usuarios',{
        method:'POST',body:JSON.stringify({email:email.trim(),senha,tipo})
      },token);
      setEmail('');setSenha('');
      atualizar();
      Alert.alert('Pronto','Usuário cadastrado.');
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  return (
    <ScrollView contentContainerStyle={s.pagina} keyboardShouldPersistTaps="handled">
      <Cabecalho eyebrow="Administrador" titulo="Cadastro de usuários"/>

      <View style={s.formPanel}>
        <Campo label="Usuário" value={email} onChangeText={setEmail} autoCapitalize="none"/>
        <Campo label="Senha" value={senha} onChangeText={setSenha} secureTextEntry/>
        <Seletor label="Permissão" valor={tipo}
          opcoes={[{valor:'admin',label:'admin'},{valor:'usuario',label:'usuario'}]}
          onChange={setTipo}/>
        <View style={s.actionRow}>
          <Botao texto="Cadastrar usuário" onPress={cadastrar}/>
        </View>
      </View>

      <View style={s.painel}>
        <Text style={s.painelTitulo}>Usuários cadastrados</Text>
        <View style={s.tabela}>
          <View style={s.tabelaHead}>
            <Text style={[s.th,{flex:2}]}>Usuário</Text>
            <Text style={[s.th,{flex:1}]}>Permissão</Text>
          </View>
          {dados.map(u=>
            <View key={u.id} style={s.tabelaLinha}>
              <Text style={[s.td,{flex:2}]}>{u.email}</Text>
              <View style={[s.tdBox,{flex:1}]}>
                <View style={s.pill}><Text style={s.pillTexto}>{u.tipo}</Text></View>
              </View>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

/* ===================================================== */
/* Componentes reutilizáveis                             */
/* ===================================================== */

function Cabecalho({eyebrow,titulo}:{eyebrow:string;titulo:string}){
  return (
    <View style={s.heading}>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={s.h1}>{titulo}</Text>
    </View>
  );
}

function Campo({label,altura,...props}:{label:string;altura?:number} & TextInputProps){
  const [foco,setFoco] = useState(false);
  return (
    <View style={s.campo}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor="#8a8f98"
        onFocus={()=>setFoco(true)}
        onBlur={()=>setFoco(false)}
        style={[
          s.input,
          props.multiline && {height:altura || 100,textAlignVertical:'top'},
          foco && s.inputFoco
        ]}
      />
    </View>
  );
}

function Seletor({
  label,valor,opcoes,onChange,placeholder
}:{
  label:string;valor:string;opcoes:{valor:string;label:string}[];
  onChange:(v:string)=>void;placeholder?:string
}){
  const [aberto,setAberto] = useState(false);
  const atual = opcoes.find(o=>o.valor===valor);
  return (
    <View style={s.campo}>
      <Text style={s.label}>{label}</Text>
      <Pressable style={[s.input,s.select,aberto && s.inputFoco]} onPress={()=>setAberto(!aberto)}>
        <Text style={[s.selectTexto,!atual && {color:'#8a8f98'}]}>
          {atual?.label || placeholder || 'Selecione'}
        </Text>
        <Text style={s.seta}>{aberto?'▲':'▼'}</Text>
      </Pressable>
      {aberto &&
        <View style={s.opcoes}>
          <ScrollView style={{maxHeight:200}} nestedScrollEnabled>
            {opcoes.length===0 && <Text style={s.opcaoTexto}>Nenhuma opção disponível.</Text>}
            {opcoes.map(o=>
              <Pressable key={o.valor} style={[s.opcao,o.valor===valor && s.opcaoAtiva]}
                onPress={()=>{onChange(o.valor);setAberto(false);}}>
                <Text style={s.opcaoTexto}>{o.label}</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      }
    </View>
  );
}

function Botao({
  texto,onPress,tipo='primario',cheio
}:{
  texto:string;onPress:()=>void;
  tipo?:'primario'|'laranja'|'contorno';cheio?:boolean
}){
  return (
    <Pressable
      onPress={onPress}
      style={({pressed})=>[
        s.botao,
        cheio && {alignSelf:'stretch',alignItems:'center',paddingVertical:12},
        tipo==='laranja' && {backgroundColor:pressed?C.laranjaEscuro:C.laranja},
        tipo==='contorno' && s.botaoContorno,
        tipo==='primario' && pressed && {backgroundColor:C.azulEscuro,opacity:.9}
      ]}>
      <Text style={[s.botaoTexto,tipo==='contorno' && {color:'#6c757d',fontWeight:'400'}]}>{texto}</Text>
    </Pressable>
  );
}

function NavBotao({texto,onPress,ativo}:{texto:string;onPress:()=>void;ativo:boolean}){
  return (
    <Pressable onPress={onPress}
      style={[s.navBtn,ativo && {backgroundColor:C.laranja}]}>
      <Text style={[s.navBtnTexto,ativo && {color:C.branco}]}>{texto}</Text>
    </Pressable>
  );
}

/* ===================================================== */
/* Estilos                                               */
/* ===================================================== */

const s = StyleSheet.create({
  tela:{flex:1,backgroundColor:C.cinza},
  centro:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:C.cinza},
  textoBase:{fontSize:14,color:C.texto},

  /* login */
  loginTela:{flex:1,backgroundColor:C.branco},
  loginFoto:{width:'100%',height:300},
  loginPainel:{flex:1,backgroundColor:C.branco,alignItems:'center',padding:32,paddingBottom:48},
  authCard:{width:'100%',maxWidth:320},
  authLogo:{width:180,height:77,marginLeft:-8,marginBottom:4},
  authTitulo:{fontSize:32,fontWeight:'700',color:C.texto,marginBottom:24},

  /* navbar */
  navbar:{
    backgroundColor:C.azul,
    paddingTop:Platform.OS==='android' ? (StatusBar.currentHeight||0) : 0
  },
  navbarTopo:{
    flexDirection:'row',justifyContent:'space-between',alignItems:'center',
    paddingHorizontal:16,paddingTop:10
  },
  navbarMarca:{color:C.branco,fontSize:18,fontWeight:'700'},
  navbarLinks:{paddingHorizontal:12,paddingVertical:10,alignItems:'center'},
  navBtn:{
    backgroundColor:C.branco,borderRadius:6,
    paddingVertical:7,paddingHorizontal:13,marginHorizontal:3
  },
  navBtnTexto:{color:C.azul,fontWeight:'600',fontSize:14},

  /* páginas */
  pagina:{padding:16,paddingBottom:40},
  heading:{marginBottom:14},
  eyebrow:{
    fontSize:13,color:C.laranja,fontWeight:'700',
    textTransform:'uppercase',marginBottom:4
  },
  h1:{fontSize:28,color:C.azul,fontWeight:'700'},

  /* formulário */
  formPanel:{width:'100%',maxWidth:480,alignSelf:'center',marginVertical:10},
  campo:{marginBottom:16},
  label:{fontSize:14,color:C.texto,fontWeight:'700',marginBottom:6},
  input:{
    borderWidth:1,borderColor:C.input,borderRadius:6,backgroundColor:C.branco,
    paddingVertical:10,paddingHorizontal:12,fontSize:15,color:C.texto
  },
  inputFoco:{borderColor:C.azul,borderWidth:1.5},
  actionRow:{flexDirection:'row',marginTop:6},

  select:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  selectTexto:{fontSize:15,color:C.texto,flex:1},
  seta:{fontSize:10,color:C.label,marginLeft:8},
  opcoes:{
    borderWidth:1,borderColor:C.input,borderRadius:6,
    backgroundColor:C.branco,marginTop:4,overflow:'hidden'
  },
  opcao:{paddingVertical:11,paddingHorizontal:12,borderBottomWidth:1,borderBottomColor:C.cinza},
  opcaoAtiva:{backgroundColor:C.cinza},
  opcaoTexto:{fontSize:15,color:C.texto,padding:2},

  /* botões */
  botao:{
    backgroundColor:C.azul,paddingVertical:9,paddingHorizontal:14,
    borderRadius:6,alignSelf:'flex-start',marginRight:10
  },
  botaoContorno:{backgroundColor:'transparent',borderWidth:1,borderColor:'#6c757d'},
  botaoTexto:{color:C.branco,fontSize:15,fontWeight:'600'},

  /* painel branco (data-panel) */
  painel:{backgroundColor:C.branco,borderRadius:6,padding:16,marginTop:14},
  painelTitulo:{fontSize:20,color:C.texto,marginBottom:12},

  /* cards de produto / movimentação */
  card:{
    backgroundColor:C.branco,borderRadius:6,borderWidth:1,
    borderColor:C.borda,marginBottom:12,overflow:'hidden'
  },
  cardHeader:{
    flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:6
  },
  cardNome:{fontSize:17,fontWeight:'700',color:C.azul,flex:1,marginRight:8},
  cardCorpo:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingBottom:12},
  cardLinha:{fontSize:14,color:C.texto,marginBottom:3},
  cardRotulo:{fontWeight:'700'},
  alertaBaixo:{fontSize:13,fontWeight:'700',color:C.laranjaEscuro,marginTop:4},
  thumb:{width:64,height:64,borderRadius:4,marginRight:12,backgroundColor:C.cinza},
  acoes:{
    flexDirection:'row',flexWrap:'wrap',paddingHorizontal:12,paddingBottom:12
  },
  movItem:{
    borderTopWidth:1,borderTopColor:C.borda,paddingVertical:12
  },

  /* tag de categoria / permissão */
  pill:{
    backgroundColor:C.laranja,borderRadius:12,
    paddingVertical:3,paddingHorizontal:10,alignSelf:'flex-start'
  },
  pillTexto:{color:C.branco,fontSize:13,fontWeight:'600'},

  /* tabela */
  tabela:{borderWidth:1,borderColor:C.borda},
  tabelaHead:{flexDirection:'row',backgroundColor:C.azul},
  th:{color:C.branco,fontWeight:'700',padding:10,fontSize:14},
  tabelaLinha:{flexDirection:'row',borderTopWidth:1,borderTopColor:C.borda,alignItems:'center'},
  td:{padding:10,fontSize:14,color:C.texto},
  tdBox:{padding:8}
});

// o ActivityIndicator, Image etc. usam as cores acima; nenhum CSS externo é necessário.

