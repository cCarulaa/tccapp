import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, SafeAreaView,
  StyleSheet, Text, TextInput, View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';

type User = {id:number; email:string; tipo:'admin'|'usuario'};
type Product = {
  id:number; nome:string; categoria:string; quantidade:number;
  estoque_minimo:number; preco:number; foto?:string;
};
type Movement = {
  id:number; produto:string; tipo:string; quantidade:number;
  usuario:string; data_hora:string;
};

async function api(path:string, options:any={}, token=''){
  const headers:any = {'Content-Type':'application/json'};
  if(token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(API + path, {...options, headers});
  const body = await res.json().catch(()=>({}));

  if(!res.ok) throw new Error(body.message || 'Erro na operação');
  return body.data;
}

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

  if(loading) return <View style={s.centro}><ActivityIndicator size="large"/></View>;
  if(!token || !user) return <Login entrar={entrar}/>;
  return <Principal user={user} token={token} sair={sair}/>;
}

function Login({entrar}:{entrar:(e:string,s:string)=>Promise<void>}){
  const [email,setEmail] = useState('');
  const [senha,setSenha] = useState('');

  async function fazerLogin(){
    if(!email || !senha) return Alert.alert('Atenção','Preencha e-mail e senha.');
    try{await entrar(email.trim(),senha);}
    catch(e:any){Alert.alert('Erro no login',e.message);}
  }

  return (
    <SafeAreaView style={s.tela}>
      <View style={s.caixa}>
        <Text style={s.titulo}>Almoxarifado</Text>
        <Text>E-mail</Text>
        <TextInput style={s.input} value={email} onChangeText={setEmail}
          autoCapitalize="none" keyboardType="email-address"/>
        <Text>Senha</Text>
        <TextInput style={s.input} value={senha} onChangeText={setSenha}
          secureTextEntry/>
        <Botao texto="Entrar" onPress={fazerLogin}/>
      </View>
    </SafeAreaView>
  );
}

function Principal({user,token,sair}:{user:User;token:string;sair:()=>Promise<void>}){
  const [pagina,setPagina] = useState('inicio');
  const [produtos,setProdutos] = useState<Product[]>([]);
  const [movimentos,setMovimentos] = useState<Movement[]>([]);
  const [usuarios,setUsuarios] = useState<User[]>([]);

  async function carregar(){
    try{
      setProdutos((await api('/produtos',{},token)) || []);
      if(pagina==='movimentos')
        setMovimentos((await api('/movimentacoes',{},token)) || []);
      if(pagina==='usuarios' && user.tipo==='admin')
        setUsuarios((await api('/usuarios',{},token)) || []);
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  useEffect(()=>{carregar();},[pagina]);

  return (
    <SafeAreaView style={s.tela}>
      <View style={s.topo}>
        <Text>{user.email}</Text>
        <Pressable onPress={sair}><Text style={{color:'red'}}>Sair</Text></Pressable>
      </View>

      <View style={{flex:1}}>
        {pagina==='inicio' && <Inicio produtos={produtos} irProdutos={()=>setPagina('produtos')}/>}
        {pagina==='produtos' &&
          <Produtos produtos={produtos} token={token} admin={user.tipo==='admin'} atualizar={carregar}/>
        }
        {pagina==='movimentos' && <Movimentacoes dados={movimentos}/>}
        {pagina==='usuarios' && <ListaUsuarios dados={usuarios}/>}
      </View>

      <View style={s.menu}>
        <ItemMenu texto="Início" onPress={()=>setPagina('inicio')}/>
        <ItemMenu texto="Produtos" onPress={()=>setPagina('produtos')}/>
        <ItemMenu texto="Movimentos" onPress={()=>setPagina('movimentos')}/>
        {user.tipo==='admin' && <ItemMenu texto="Usuários" onPress={()=>setPagina('usuarios')}/>}
      </View>
    </SafeAreaView>
  );
}

function Inicio({produtos,irProdutos}:{produtos:Product[];irProdutos:()=>void}){
  const baixos = produtos.filter(p=>p.estoque_minimo>0 && p.quantidade<=p.estoque_minimo).length;
  return (
    <View style={s.caixa}>
      <Text style={s.titulo}>Início</Text>
      <Text>Quantidade de produtos cadastrados: {produtos.length}</Text>
      <Text style={{marginTop:8}}>Produtos com estoque baixo: {baixos}</Text>
      <Botao texto="Ver produtos" onPress={irProdutos}/>
    </View>
  );
}

function Produtos({
  produtos,token,admin,atualizar
}:{
  produtos:Product[];token:string;admin:boolean;atualizar:()=>void
}){
  const [novo,setNovo] = useState(false);
  const [editando,setEditando] = useState<Product|null>(null);

  if(novo || editando){
    return <FormularioProduto
      token={token} produto={editando}
      voltar={()=>{setNovo(false);setEditando(null);}}
      atualizar={atualizar}
    />;
  }

  return (
    <View style={s.pagina}>
      <View style={s.linha}>
        <Text style={s.titulo}>Produtos</Text>
        {admin && <Botao texto="+ Produto" onPress={()=>setNovo(true)}/>}
      </View>

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

  async function excluir(){
    try{
      await api(`/produtos/${produto.id}`,{method:'DELETE'},token);
      atualizar();
    }catch(e:any){Alert.alert('Erro',e.message);}
  }

  return (
    <View style={s.item}>
      <Text style={s.nome}>{produto.nome}</Text>
      <Text>Categoria: {produto.categoria}</Text>
      <Text>Estoque: {produto.quantidade}</Text>
      <Text>Preço: R$ {Number(produto.preco||0).toFixed(2)}</Text>

      <TextInput style={s.input} value={qtd} onChangeText={setQtd}
        keyboardType="number-pad" placeholder="Quantidade"/>

      <View style={s.linha}>
        {admin && <Botao texto="Entrada" onPress={()=>estoque('adicionar')}/>}
        <Botao texto="Retirar" onPress={()=>estoque('retirar')}/>
        {admin && <Botao texto="Editar" onPress={editar}/>}
        {admin && <Botao texto="Excluir" onPress={()=>
          Alert.alert('Excluir produto?','',[
            {text:'Cancelar'},
            {text:'Excluir',style:'destructive',onPress:excluir}
          ])
        }/>}
      </View>
    </View>
  );
}

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
    <View style={s.pagina}>
      <Botao texto="Voltar" onPress={voltar}/>
      <Text style={s.titulo}>{produto?'Editar produto':'Novo produto'}</Text>

      <FlatList
        data={[]}
        ListHeaderComponent={
          <View>
            <Text>Nome</Text>
            <TextInput style={s.input} value={nome} onChangeText={setNome}/>
            <Text>Categoria</Text>
            <TextInput style={s.input} value={categoria} onChangeText={setCategoria}/>
            <Text>Quantidade</Text>
            <TextInput style={s.input} value={quantidade} onChangeText={setQuantidade} keyboardType="number-pad"/>
            <Text>Estoque mínimo</Text>
            <TextInput style={s.input} value={minimo} onChangeText={setMinimo} keyboardType="number-pad"/>
            <Text>Preço</Text>
            <TextInput style={s.input} value={preco} onChangeText={setPreco} keyboardType="decimal-pad"/>
            <Text>Foto URL (opcional)</Text>
            <TextInput style={s.input} value={foto} onChangeText={setFoto} autoCapitalize="none"/>
            <Botao texto="Salvar" onPress={salvar}/>
          </View>
        }
      />
    </View>
  );
}

function Movimentacoes({dados}:{dados:Movement[]}){
  return (
    <View style={s.pagina}>
      <Text style={s.titulo}>Movimentações</Text>
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

function ListaUsuarios({dados}:{dados:User[]}){
  return (
    <View style={s.pagina}>
      <Text style={s.titulo}>Usuários</Text>
      <FlatList
        data={dados}
        keyExtractor={u=>String(u.id)}
        renderItem={({item})=>
          <View style={s.item}>
            <Text>{item.email}</Text>
            <Text>Tipo: {item.tipo}</Text>
          </View>
        }
      />
    </View>
  );
}

function Botao({texto,onPress}:{texto:string;onPress:()=>void}){
  return (
    <Pressable style={s.botao} onPress={onPress}>
      <Text style={s.textoBotao}>{texto}</Text>
    </Pressable>
  );
}

function ItemMenu({texto,onPress}:{texto:string;onPress:()=>void}){
  return <Pressable style={s.menuItem} onPress={onPress}><Text>{texto}</Text></Pressable>;
}

const s = StyleSheet.create({
  tela:{flex:1,backgroundColor:'#f3f3f3'},
  centro:{flex:1,alignItems:'center',justifyContent:'center'},
  caixa:{padding:20},
  topo:{backgroundColor:'#fff',padding:14,flexDirection:'row',justifyContent:'space-between'},
  titulo:{fontSize:23,fontWeight:'bold',marginVertical:12},
  pagina:{flex:1,padding:12},
  input:{borderWidth:1,borderColor:'#bbb',borderRadius:5,backgroundColor:'#fff',padding:9,marginVertical:7},
  botao:{backgroundColor:'#2367c9',padding:10,margin:3,borderRadius:5,alignSelf:'flex-start'},
  textoBotao:{color:'#fff',fontWeight:'bold'},
  item:{backgroundColor:'#fff',padding:12,marginBottom:10,borderWidth:1,borderColor:'#ddd',borderRadius:5},
  nome:{fontSize:17,fontWeight:'bold',marginBottom:4},
  linha:{flexDirection:'row',alignItems:'center',flexWrap:'wrap'},
  menu:{height:52,backgroundColor:'#fff',flexDirection:'row',justifyContent:'space-around',alignItems:'center',borderTopWidth:1,borderColor:'#ccc'},
  menuItem:{padding:8}
});
