
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Platform, Pressable, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = 'http://10.154.20.28:5000/api';

// cores do senai igual do outro tcc
const AZUL = '#0d1860';
const LARANJA = '#f7931e';
const FUNDO = '#edf1f5';
const BORDA = '#d5dae1';

type User = {id:number; email:string; tipo:'admin'|'usuario'};
type Product = {
  id:number; nome:string; categoria:string; quantidade:number;
  estoque_minimo:number; preco:number; foto?:string;
};
type Movement = {
  id:number; produto:string; tipo:string; quantidade:number;
  usuario:string; data_hora:string;
};

// função para falar com a API
async function api(path:string, options:any={}, token=''){
  const headers:any = {'Content-Type':'application/json'};
  if(token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(API + path, {...options, headers});
  const body = await res.json().catch(()=>({}));

  if(!res.ok) throw new Error(body.message || 'Erro na operação');
  return body.data;
}

// decide qual tela mostrar (carregando, login ou o app principal)
export default function App(){
  const [token,setToken] = useState('');
  const [user,setUser] = useState<User|null>(null);
  const [loading,setLoading] = useState(true);

  // serve pra salvar os dados 
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

  // encerra a sessão
  async function sair(){
    try{
      if(token) await api('/auth/logout',{method:'POST'},token);
    }catch{}
    await AsyncStorage.multiRemove(['token','user']);
    setToken('');
    setUser(null);
  }

  if(loading) return <View style={s.centro}><ActivityIndicator size="large" color={AZUL}/></View>;
  if(!token || !user) return <Login entrar={entrar}/>;
  return <Principal user={user} token={token} sair={sair}/>;
}

function Login({entrar}:{entrar:(e:string,s:string)=>Promise<void>}){
  const [email,setEmail] = useState('');
  const [senha,setSenha] = useState('');

  // valida os campos antes de da api
  async function fazerLogin(){
    if(!email || !senha) return Alert.alert('Atenção','Preencha e-mail e senha.');
    try{await entrar(email.trim(),senha);}
    catch(e:any){Alert.alert('Erro no login',e.message);}
  }

  return (
    <SafeAreaView style={s.login}>
      <Image source={require('./assets/fotologin.jpg')} style={s.fotoLogin}/>
      <View style={s.caixaLogin}>
        <Image source={require('./assets/logosenai.png')} style={s.logo}/>
        <Text style={s.tituloLogin}>Login</Text>

        <Text style={s.label}>Usuário</Text>
        <TextInput style={s.input} value={email} onChangeText={setEmail}
          autoCapitalize="none" keyboardType="email-address"/>
        <Text style={s.label}>Senha</Text>
        <TextInput style={s.input} value={senha} onChangeText={setSenha}
          secureTextEntry/>
        <Botao texto="Entrar" onPress={fazerLogin} cheio/>
      </View>
    </SafeAreaView>
  );
}

// tela principal
function Principal({user,token,sair}:{user:User;token:string;sair:()=>Promise<void>}){
  const [pagina,setPagina] = useState('produtos');
  const [produtos,setProdutos] = useState<Product[]>([]);
  const [movimentos,setMovimentos] = useState<Movement[]>([]);
  const [usuarios,setUsuarios] = useState<User[]>([]);
  const admin = user.tipo==='admin';

  // busca os dados na api
  async function carregar(){
    try{
      setProdutos((await api('/produtos',{},token)) || []);
      if(pagina==='movimentos')
        setMovimentos((await api('/movimentacoes',{},token)) || []);
      if(pagina==='usuarios' && admin)
        setUsuarios((await api('/usuarios',{},token)) || []);
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  // recarrega os dados quando o usuário troca de página
  useEffect(()=>{carregar();},[pagina]);

  return (
    <SafeAreaView style={s.tela}>
      <View style={s.topo}>
        <Text style={s.marca}>Almoxarifado</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ItemMenu texto="Início" onPress={()=>setPagina('inicio')}/>
          <ItemMenu texto="Produtos" onPress={()=>setPagina('produtos')}/>
          {admin && <ItemMenu texto="Novo Produto" onPress={()=>setPagina('novo')}/>}
          <ItemMenu texto="Movimentação" onPress={()=>setPagina('movimentos')}/>
          {admin && <ItemMenu texto="Usuários" onPress={()=>setPagina('usuarios')}/>}
          <ItemMenu texto="Sair" onPress={sair} laranja/>
        </ScrollView>
      </View>

      <View style={{flex:1}}>
        {pagina==='inicio' && <Inicio produtos={produtos} irProdutos={()=>setPagina('produtos')}/>}
        {pagina==='produtos' &&
          <Produtos produtos={produtos} token={token} admin={admin} atualizar={carregar}/>
        }
        {pagina==='novo' &&
          <FormularioProduto token={token} produto={null}
            voltar={()=>setPagina('produtos')} atualizar={carregar}/>
        }
        {pagina==='movimentos' && <Movimentacoes dados={movimentos}/>}
        {pagina==='usuarios' && <ListaUsuarios dados={usuarios}/>}
      </View>
    </SafeAreaView>
  );
}

function Cabecalho({etiqueta,titulo}:{etiqueta?:string;titulo:string}){
  return (
    <View style={{marginBottom:12}}>
      {etiqueta && <Text style={s.etiqueta}>{etiqueta}</Text>}
      <Text style={s.titulo}>{titulo}</Text>
    </View>
  );
}

// pagina inicial
function Inicio({produtos,irProdutos}:{produtos:Product[];irProdutos:()=>void}){
  const baixos = produtos.filter(p=>p.estoque_minimo>0 && p.quantidade<=p.estoque_minimo).length;
  return (
    <View style={s.pagina}>
      <Cabecalho titulo="Início"/>
      <View style={s.item}>
        <Text>Quantidade de produtos cadastrados: {produtos.length}</Text>
        <Text style={{marginTop:8}}>Produtos com estoque baixo: {baixos}</Text>
        <View style={{marginTop:10}}>
          <Botao texto="Ver produtos" onPress={irProdutos}/>
        </View>
      </View>
    </View>
  );
}

function Produtos({
  produtos,token,admin,atualizar
}:{
  produtos:Product[];token:string;admin:boolean;atualizar:()=>void
}){
  const [editando,setEditando] = useState<Product|null>(null);

  if(editando){
    return <FormularioProduto
      token={token} produto={editando}
      voltar={()=>setEditando(null)}
      atualizar={atualizar}
    />;
  }

  return (
    <View style={s.pagina}>
      <Cabecalho titulo="Produtos Cadastrados"/>
      <FlatList
        data={produtos}
        keyExtractor={p=>String(p.id)}
        ListEmptyComponent={<Text>Nenhum produto cadastrado.</Text>}
        renderItem={({item})=>
          <Produto
            produto={item} token={token} admin={admin}
            editar={()=>setEditando(item)} atualizar={atualizar}
          />
        }
      />
    </View>
  );
}

function Produto({
  produto,token,admin,editar,atualizar
}:{
  produto:Product;token:string;admin:boolean;editar:()=>void;atualizar:()=>void
}){
  const [qtd,setQtd] = useState('1');

  // da entrada ou retira estoque
  async function estoque(tipo:'adicionar'|'retirar'){
    const n = Number(qtd);
    if(!Number.isInteger(n) || n<=0) return Alert.alert('Digite uma quantidade válida.');
    try{
      await api(`/produtos/${produto.id}/${tipo}`,{
        method:'POST',body:JSON.stringify({quantidade:n})
      },token);
      setQtd('1');
      atualizar();
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  // exclui o produto
  async function excluir(){
    try{
      await api(`/produtos/${produto.id}`,{method:'DELETE'},token);
      atualizar();
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  const baixo = produto.estoque_minimo>0 && produto.quantidade<=produto.estoque_minimo;

  return (
    <View style={s.item}>
      <View style={s.linhaEntre}>
        <Text style={s.nome}>{produto.nome}</Text>
        {baixo && <Text style={s.selo}>estoque baixo</Text>}
      </View>
      <Text>Categoria: {produto.categoria}</Text>
      <Text>Estoque: {produto.quantidade}</Text>
      <Text>Preço: R$ {Number(produto.preco||0).toFixed(2)}</Text>

      <TextInput style={s.input} value={qtd} onChangeText={setQtd}
        keyboardType="number-pad" placeholder="Quantidade"/>

      <View style={s.linha}>
        {admin && <Botao texto="Entrada" onPress={()=>estoque('adicionar')}/>}
        <Botao texto="Retirar" onPress={()=>estoque('retirar')}/>
        {admin && <Botao texto="Editar" claro onPress={editar}/>}
        {/* pede confirmação antes de excluir, porque não dá para desfazer */}
        {admin && <Botao texto="Excluir" claro onPress={()=>
          Alert.alert('Excluir produto?','',[
            {text:'Cancelar'},
            {text:'Excluir',style:'destructive',onPress:excluir}
          ])
        }/>}
      </View>
    </View>
  );
}

// formulario usado para cadastrar e editar
function FormularioProduto({
  token,produto,voltar,atualizar
}:{
  token:string;produto:Product|null;voltar:()=>void;atualizar:()=>void
}){
  const [nome,setNome] = useState(produto?.nome || '');
  const [categoria,setCategoria] = useState(produto?.categoria || '');
  const [quantidade,setQuantidade] = useState(String(produto?.quantidade ?? 0));
  const [minimo,setMinimo] = useState(String(produto?.estoque_minimo ?? 0));
  const [preco,setPreco] = useState(String(produto?.preco ?? 0));
  const [foto,setFoto] = useState(produto?.foto || '');

  async function salvar(){
    if(!nome.trim() || !categoria.trim())
      return Alert.alert('Preencha nome e categoria.');

    const dados = {
      nome:nome.trim(),categoria:categoria.trim(),
      quantidade:Number(quantidade),estoque_minimo:Number(minimo),
      preco:Number(preco.replace(',','.')),foto:foto || null
    };

    try{
      await api(produto?`/produtos/${produto.id}`:'/produtos',{
        method:produto?'PUT':'POST',body:JSON.stringify(dados)
      },token);
      Alert.alert('Pronto',produto?'Produto editado.':'Produto cadastrado.');
      atualizar();
      voltar();
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  return (
    <ScrollView style={s.pagina} keyboardShouldPersistTaps="handled">
      <Cabecalho etiqueta="CADASTRO" titulo={produto?'Editar item':'Novo item'}/>

      <Text style={s.label}>Nome</Text>
      <TextInput style={s.input} value={nome} onChangeText={setNome}/>
      <Text style={s.label}>Categoria</Text>
      <TextInput style={s.input} value={categoria} onChangeText={setCategoria}/>
      <Text style={s.label}>Quantidade em estoque</Text>
      <TextInput style={s.input} value={quantidade} onChangeText={setQuantidade} keyboardType="number-pad"/>
      <Text style={s.label}>Estoque mínimo</Text>
      <TextInput style={s.input} value={minimo} onChangeText={setMinimo} keyboardType="number-pad"/>
      <Text style={s.label}>Preço</Text>
      <TextInput style={s.input} value={preco} onChangeText={setPreco} keyboardType="decimal-pad" placeholder="0,00"/>
      <Text style={s.label}>Foto URL (opcional)</Text>
      <TextInput style={s.input} value={foto} onChangeText={setFoto} autoCapitalize="none"/>

      <View style={[s.linha,{marginTop:8,marginBottom:30}]}>
        <Botao texto="Voltar" claro onPress={voltar}/>
        <Botao texto="Salvar item" onPress={salvar}/>
      </View>
    </ScrollView>
  );
}

// movimentações (entradas, retiradas e edições)
function Movimentacoes({dados}:{dados:Movement[]}){
  return (
    <View style={s.pagina}>
      <Cabecalho titulo="Movimentações"/>
      <FlatList
        data={dados}
        keyExtractor={m=>String(m.id)}
        ListEmptyComponent={<Text>Nenhuma movimentação registrada.</Text>}
        renderItem={({item})=>
          <View style={s.item}>
            <Text style={s.nome}>{item.produto}</Text>
            <Text>Tipo: {item.tipo}</Text>
            <Text>Quantidade: {item.quantidade}</Text>
            <Text>Usuário: {item.usuario}</Text>
            <Text>Data: {item.data_hora}</Text>
          </View>
        }
      />
    </View>
  );
}

// usuarios cadastrados (só aparece para o admin)
function ListaUsuarios({dados}:{dados:User[]}){
  return (
    <View style={s.pagina}>
      <Cabecalho etiqueta="ADMINISTRADOR" titulo="Usuários cadastrados"/>
      <FlatList
        data={dados}
        keyExtractor={u=>String(u.id)}
        renderItem={({item})=>
          <View style={s.item}>
            <Text style={s.nome}>{item.email}</Text>
            <Text style={item.tipo==='admin' ? s.selo : undefined}>{item.tipo}</Text>
          </View>
        }
      />
    </View>
  );
};

function Botao({texto,onPress,claro,cheio}:{texto:string;onPress:()=>void;claro?:boolean;cheio?:boolean}){
  return (
    <Pressable
      style={[s.botao, claro && s.botaoClaro, cheio && {alignSelf:'stretch',alignItems:'center'}]}
      onPress={onPress}>
      <Text style={[s.textoBotao, claro && {color:AZUL}]}>{texto}</Text>
    </Pressable>
  );
}

function ItemMenu({texto,onPress,laranja}:{texto:string;onPress:()=>void;laranja?:boolean}){
  return (
    <Pressable style={[s.menuItem, laranja && {backgroundColor:LARANJA}]} onPress={onPress}>
      <Text style={[s.textoMenu, laranja && {color:'#fff'}]}>{texto}</Text>
    </Pressable>
  );
}

// tudo de estilo aqui
const s = StyleSheet.create({
  tela:{flex:1,backgroundColor:FUNDO},
  centro:{flex:1,alignItems:'center',justifyContent:'center'},

  // login
  login:{flex:1,backgroundColor:'#fff'},
  fotoLogin:{width:'100%',height:230,resizeMode:'cover'},
  caixaLogin:{padding:28,paddingTop:20},
  logo:{width:'100%',height:120,resizeMode:'contain',marginLeft:'-11%'},
  tituloLogin:{fontSize:26,fontWeight:'bold',marginTop:6,marginBottom:20,color:'#111'},

  topo:{backgroundColor:AZUL,paddingTop:12 + (Platform.OS==='android' ? (StatusBar.currentHeight || 0) : 0),paddingBottom:10,paddingHorizontal:14},
  marca:{color:'#fff',fontSize:19,fontWeight:'bold',marginBottom:10},
  menuItem:{backgroundColor:'#fff',paddingVertical:7,paddingHorizontal:12,borderRadius:6,marginRight:6},
  textoMenu:{color:AZUL,fontWeight:'bold'},

  pagina:{flex:1,padding:16},
  etiqueta:{color:LARANJA,fontSize:12,fontWeight:'bold'},
  titulo:{fontSize:24,fontWeight:'bold',color:AZUL},
  label:{fontWeight:'bold',color:'#111',marginTop:8},
  input:{borderWidth:1,borderColor:BORDA,borderRadius:6,backgroundColor:'#fff',padding:10,marginVertical:6},

  botao:{backgroundColor:AZUL,paddingVertical:10,paddingHorizontal:14,margin:3,borderRadius:6,alignSelf:'flex-start'},
  botaoClaro:{backgroundColor:'#fff',borderWidth:1,borderColor:BORDA},
  textoBotao:{color:'#fff',fontWeight:'bold'},

  item:{backgroundColor:'#fff',padding:14,marginBottom:10,borderWidth:1,borderColor:BORDA,borderRadius:8},
  nome:{fontSize:17,fontWeight:'bold',marginBottom:4,color:'#111'},
  selo:{backgroundColor:LARANJA,color:'#fff',fontWeight:'bold',fontSize:12,
    paddingVertical:2,paddingHorizontal:10,borderRadius:10,overflow:'hidden',alignSelf:'flex-start'},
  linha:{flexDirection:'row',alignItems:'center',flexWrap:'wrap'},
  linhaEntre:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}
});
