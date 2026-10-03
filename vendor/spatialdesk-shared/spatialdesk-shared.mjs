import {
  VOID3gxj6tk5isa35 as VOID,
  protoOf180f3jzyo7rfj as protoOf,
  Unit_instancev9v8hjid95df as Unit_instance,
  defineProp3ur6h3slcvq4x as defineProp,
  initMetadataForClassbxx6q50dy2s7 as initMetadataForClass,
  initMetadataForCompanion1wyw17z38v6ac as initMetadataForCompanion,
  THROW_CCE2g6jy02ryeudk as THROW_CCE,
  initMetadataForObject1cxne3s9w65el as initMetadataForObject,
  objectCreate1ve4bgxiu4x98 as objectCreate,
  getKClass3t8tygqu4lcxf as getKClass,
  getStringHashCode26igk1bx568vk as getStringHashCode,
  getNumberHashCode2l4nbdcihl25f as getNumberHashCode,
  equals2au1ep9vhcato as equals,
  LazyThreadSafetyMode_PUBLICATION_getInstance3qslfm3vqg6y3 as LazyThreadSafetyMode_PUBLICATION_getInstance,
  lazy1261dae0bgscp as lazy,
  Companion_instance1xjg859pd52fi as Companion_instance,
  _Result___init__impl__xyqfz823vatsdepqb9n as _Result___init__impl__xyqfz8,
  createFailure8paxfkfa5dc7 as createFailure,
  _Result___get_value__impl__bjfvqg316j9v81zgqwq as _Result___get_value__impl__bjfvqg,
  _Result___get_isFailure__impl__jpiriv2lptaeb4c2198 as _Result___get_isFailure__impl__jpiriv,
} from './kotlin-kotlin-stdlib.mjs';
import {
  PluginGeneratedSerialDescriptorqdzeg5asqhfg as PluginGeneratedSerialDescriptor,
  UnknownFieldException_init_$Create$29petggjjaptk as UnknownFieldException_init_$Create$,
  StringSerializer_getInstance11v9md0a7d9yk as StringSerializer_getInstance,
  DoubleSerializer_getInstance1wncowm4p8ecy as DoubleSerializer_getInstance,
  IntSerializer_getInstanceuhm8c1wku08l as IntSerializer_getInstance,
  typeParametersSerializers2likxjr48tr7y as typeParametersSerializers,
  GeneratedSerializer1f7t7hssdd2ws as GeneratedSerializer,
  throwMissingFieldException2cmke0v3ynf14 as throwMissingFieldException,
  SealedClassSerializer_init_$Create$2e46e27g2dau6 as SealedClassSerializer_init_$Create$,
  SerializableWithd2dap36updxd as SerializableWith,
} from './kotlinx-serialization-kotlinx-serialization-core.mjs';
import { Jsonsmkyu9xjl7fv as Json } from './kotlinx-serialization-kotlinx-serialization-json.mjs';
//region block: imports
var imul = Math.imul;
//endregion
//region block: pre-declaration
initMetadataForClass(ClockSync, 'ClockSync', ClockSync);
initMetadataForCompanion(Companion);
initMetadataForObject($serializer, '$serializer', VOID, VOID, [GeneratedSerializer]);
initMetadataForCompanion(Companion_0);
initMetadataForObject($serializer_0, '$serializer', VOID, VOID, [GeneratedSerializer]);
initMetadataForClass(ServerMessage, 'ServerMessage', VOID, VOID, VOID, VOID, VOID, {0: Companion_getInstance_1});
initMetadataForClass(Hello, 'Hello', VOID, ServerMessage, VOID, VOID, VOID, {0: $serializer_getInstance});
initMetadataForClass(Pong, 'Pong', VOID, ServerMessage, VOID, VOID, VOID, {0: $serializer_getInstance_0});
initMetadataForCompanion(Companion_1);
initMetadataForCompanion(Companion_2);
initMetadataForObject($serializer_1, '$serializer', VOID, VOID, [GeneratedSerializer]);
initMetadataForClass(ClientMessage, 'ClientMessage', VOID, VOID, VOID, VOID, VOID, {0: Companion_getInstance_3});
initMetadataForClass(Ping, 'Ping', VOID, ClientMessage, VOID, VOID, VOID, {0: $serializer_getInstance_1});
initMetadataForCompanion(Companion_3);
initMetadataForObject(Protocol, 'Protocol');
//endregion
function ClockSync(window_0) {
  window_0 = window_0 === VOID ? 8 : window_0;
  this.zp_1 = window_0;
  this.aq_1 = new Float64Array(this.zp_1);
  this.bq_1 = new Float64Array(this.zp_1);
  this.cq_1 = 0;
  this.offsetMs = 0.0;
  this.rttMs = -1.0;
}
protoOf(ClockSync).dq = function () {
  return this.offsetMs;
};
protoOf(ClockSync).eq = function () {
  return this.rttMs;
};
protoOf(ClockSync).fq = function () {
  return this.cq_1 > 0;
};
protoOf(ClockSync).onPong = function (sentLocalMs, serverTimeMs, receivedLocalMs) {
  var rtt = receivedLocalMs - sentLocalMs;
  if (rtt < 0)
    return Unit_instance;
  var i = this.cq_1 % this.zp_1 | 0;
  this.aq_1[i] = serverTimeMs - (sentLocalMs + receivedLocalMs) / 2;
  this.bq_1[i] = rtt;
  this.cq_1 = this.cq_1 + 1 | 0;
  var best = 0;
  var inductionVariable = 1;
  var tmp0 = this.cq_1;
  // Inline function 'kotlin.comparisons.minOf' call
  var b = this.zp_1;
  var last = Math.min(tmp0, b);
  if (inductionVariable < last)
    do {
      var k = inductionVariable;
      inductionVariable = inductionVariable + 1 | 0;
      if (this.bq_1[k] < this.bq_1[best])
        best = k;
    }
     while (inductionVariable < last);
  this.offsetMs = this.aq_1[best];
  this.rttMs = this.bq_1[best];
};
protoOf(ClockSync).serverNow = function (localMs) {
  return localMs + this.offsetMs;
};
function get_ProtocolJson() {
  _init_properties_Protocol_kt__345mx4();
  return ProtocolJson;
}
var ProtocolJson;
function Companion() {
}
var Companion_instance_0;
function Companion_getInstance() {
  return Companion_instance_0;
}
function $serializer() {
  $serializer_instance = this;
  var tmp0_serialDesc = new PluginGeneratedSerialDescriptor('hello', this, 3);
  tmp0_serialDesc.ie('sessionId', false);
  tmp0_serialDesc.ie('serverTimeMs', false);
  tmp0_serialDesc.ie('protocol', false);
  this.gq_1 = tmp0_serialDesc;
}
protoOf($serializer).hq = function (encoder, value) {
  var tmp0_desc = this.gq_1;
  var tmp1_output = encoder.fc(tmp0_desc);
  tmp1_output.wc(tmp0_desc, 0, value.sessionId);
  tmp1_output.vc(tmp0_desc, 1, value.serverTimeMs);
  tmp1_output.uc(tmp0_desc, 2, value.protocol);
  tmp1_output.gc(tmp0_desc);
};
protoOf($serializer).t9 = function (encoder, value) {
  return this.hq(encoder, value instanceof Hello ? value : THROW_CCE());
};
protoOf($serializer).u9 = function (decoder) {
  var tmp0_desc = this.gq_1;
  var tmp1_flag = true;
  var tmp2_index = 0;
  var tmp3_bitMask0 = 0;
  var tmp4_local0 = null;
  var tmp5_local1 = 0.0;
  var tmp6_local2 = 0;
  var tmp7_input = decoder.fc(tmp0_desc);
  if (tmp7_input.nc()) {
    tmp4_local0 = tmp7_input.jc(tmp0_desc, 0);
    tmp3_bitMask0 = tmp3_bitMask0 | 1;
    tmp5_local1 = tmp7_input.ic(tmp0_desc, 1);
    tmp3_bitMask0 = tmp3_bitMask0 | 2;
    tmp6_local2 = tmp7_input.hc(tmp0_desc, 2);
    tmp3_bitMask0 = tmp3_bitMask0 | 4;
  } else
    while (tmp1_flag) {
      tmp2_index = tmp7_input.oc(tmp0_desc);
      switch (tmp2_index) {
        case -1:
          tmp1_flag = false;
          break;
        case 0:
          tmp4_local0 = tmp7_input.jc(tmp0_desc, 0);
          tmp3_bitMask0 = tmp3_bitMask0 | 1;
          break;
        case 1:
          tmp5_local1 = tmp7_input.ic(tmp0_desc, 1);
          tmp3_bitMask0 = tmp3_bitMask0 | 2;
          break;
        case 2:
          tmp6_local2 = tmp7_input.hc(tmp0_desc, 2);
          tmp3_bitMask0 = tmp3_bitMask0 | 4;
          break;
        default:
          throw UnknownFieldException_init_$Create$(tmp2_index);
      }
    }
  tmp7_input.gc(tmp0_desc);
  return Hello_init_$Create$(tmp3_bitMask0, tmp4_local0, tmp5_local1, tmp6_local2, null);
};
protoOf($serializer).s9 = function () {
  return this.gq_1;
};
protoOf($serializer).ke = function () {
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  return [StringSerializer_getInstance(), DoubleSerializer_getInstance(), IntSerializer_getInstance()];
};
var $serializer_instance;
function $serializer_getInstance() {
  if ($serializer_instance == null)
    new $serializer();
  return $serializer_instance;
}
function Hello_init_$Init$(seen0, sessionId, serverTimeMs, protocol, serializationConstructorMarker, $this) {
  if (!(7 === (7 & seen0))) {
    throwMissingFieldException(seen0, 7, $serializer_getInstance().gq_1);
  }
  ServerMessage_init_$Init$(seen0, serializationConstructorMarker, $this);
  $this.sessionId = sessionId;
  $this.serverTimeMs = serverTimeMs;
  $this.protocol = protocol;
  return $this;
}
function Hello_init_$Create$(seen0, sessionId, serverTimeMs, protocol, serializationConstructorMarker) {
  return Hello_init_$Init$(seen0, sessionId, serverTimeMs, protocol, serializationConstructorMarker, objectCreate(protoOf(Hello)));
}
function Companion_0() {
}
var Companion_instance_1;
function Companion_getInstance_0() {
  return Companion_instance_1;
}
function $serializer_0() {
  $serializer_instance_0 = this;
  var tmp0_serialDesc = new PluginGeneratedSerialDescriptor('pong', this, 2);
  tmp0_serialDesc.ie('clientTimeMs', false);
  tmp0_serialDesc.ie('serverTimeMs', false);
  this.iq_1 = tmp0_serialDesc;
}
protoOf($serializer_0).jq = function (encoder, value) {
  var tmp0_desc = this.iq_1;
  var tmp1_output = encoder.fc(tmp0_desc);
  tmp1_output.vc(tmp0_desc, 0, value.clientTimeMs);
  tmp1_output.vc(tmp0_desc, 1, value.serverTimeMs);
  tmp1_output.gc(tmp0_desc);
};
protoOf($serializer_0).t9 = function (encoder, value) {
  return this.jq(encoder, value instanceof Pong ? value : THROW_CCE());
};
protoOf($serializer_0).u9 = function (decoder) {
  var tmp0_desc = this.iq_1;
  var tmp1_flag = true;
  var tmp2_index = 0;
  var tmp3_bitMask0 = 0;
  var tmp4_local0 = 0.0;
  var tmp5_local1 = 0.0;
  var tmp6_input = decoder.fc(tmp0_desc);
  if (tmp6_input.nc()) {
    tmp4_local0 = tmp6_input.ic(tmp0_desc, 0);
    tmp3_bitMask0 = tmp3_bitMask0 | 1;
    tmp5_local1 = tmp6_input.ic(tmp0_desc, 1);
    tmp3_bitMask0 = tmp3_bitMask0 | 2;
  } else
    while (tmp1_flag) {
      tmp2_index = tmp6_input.oc(tmp0_desc);
      switch (tmp2_index) {
        case -1:
          tmp1_flag = false;
          break;
        case 0:
          tmp4_local0 = tmp6_input.ic(tmp0_desc, 0);
          tmp3_bitMask0 = tmp3_bitMask0 | 1;
          break;
        case 1:
          tmp5_local1 = tmp6_input.ic(tmp0_desc, 1);
          tmp3_bitMask0 = tmp3_bitMask0 | 2;
          break;
        default:
          throw UnknownFieldException_init_$Create$(tmp2_index);
      }
    }
  tmp6_input.gc(tmp0_desc);
  return Pong_init_$Create$(tmp3_bitMask0, tmp4_local0, tmp5_local1, null);
};
protoOf($serializer_0).s9 = function () {
  return this.iq_1;
};
protoOf($serializer_0).ke = function () {
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  return [DoubleSerializer_getInstance(), DoubleSerializer_getInstance()];
};
var $serializer_instance_0;
function $serializer_getInstance_0() {
  if ($serializer_instance_0 == null)
    new $serializer_0();
  return $serializer_instance_0;
}
function Pong_init_$Init$(seen0, clientTimeMs, serverTimeMs, serializationConstructorMarker, $this) {
  if (!(3 === (3 & seen0))) {
    throwMissingFieldException(seen0, 3, $serializer_getInstance_0().iq_1);
  }
  ServerMessage_init_$Init$(seen0, serializationConstructorMarker, $this);
  $this.clientTimeMs = clientTimeMs;
  $this.serverTimeMs = serverTimeMs;
  return $this;
}
function Pong_init_$Create$(seen0, clientTimeMs, serverTimeMs, serializationConstructorMarker) {
  return Pong_init_$Init$(seen0, clientTimeMs, serverTimeMs, serializationConstructorMarker, objectCreate(protoOf(Pong)));
}
function _get_$cachedSerializer__te6jhj($this) {
  return $this.kq_1.v();
}
function ServerMessage$Companion$_anonymous__tx1b3p() {
  var tmp = getKClass(ServerMessage);
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  var tmp_0 = [getKClass(Hello), getKClass(Pong)];
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  var tmp_1 = [$serializer_getInstance(), $serializer_getInstance_0()];
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  var tmp$ret$6 = [];
  return SealedClassSerializer_init_$Create$('app.spatialdesk.shared.ServerMessage', tmp, tmp_0, tmp_1, tmp$ret$6);
}
function Hello(sessionId, serverTimeMs, protocol) {
  ServerMessage.call(this);
  this.sessionId = sessionId;
  this.serverTimeMs = serverTimeMs;
  this.protocol = protocol;
}
protoOf(Hello).lq = function () {
  return this.sessionId;
};
protoOf(Hello).mq = function () {
  return this.serverTimeMs;
};
protoOf(Hello).nq = function () {
  return this.protocol;
};
protoOf(Hello).i8 = function () {
  return this.sessionId;
};
protoOf(Hello).j8 = function () {
  return this.serverTimeMs;
};
protoOf(Hello).oq = function () {
  return this.protocol;
};
protoOf(Hello).pq = function (sessionId, serverTimeMs, protocol) {
  return new Hello(sessionId, serverTimeMs, protocol);
};
protoOf(Hello).copy = function (sessionId, serverTimeMs, protocol, $super) {
  sessionId = sessionId === VOID ? this.sessionId : sessionId;
  serverTimeMs = serverTimeMs === VOID ? this.serverTimeMs : serverTimeMs;
  protocol = protocol === VOID ? this.protocol : protocol;
  return $super === VOID ? this.pq(sessionId, serverTimeMs, protocol) : $super.pq.call(this, sessionId, serverTimeMs, protocol);
};
protoOf(Hello).toString = function () {
  return 'Hello(sessionId=' + this.sessionId + ', serverTimeMs=' + this.serverTimeMs + ', protocol=' + this.protocol + ')';
};
protoOf(Hello).hashCode = function () {
  var result = getStringHashCode(this.sessionId);
  result = imul(result, 31) + getNumberHashCode(this.serverTimeMs) | 0;
  result = imul(result, 31) + this.protocol | 0;
  return result;
};
protoOf(Hello).equals = function (other) {
  if (this === other)
    return true;
  if (!(other instanceof Hello))
    return false;
  if (!(this.sessionId === other.sessionId))
    return false;
  if (!equals(this.serverTimeMs, other.serverTimeMs))
    return false;
  if (!(this.protocol === other.protocol))
    return false;
  return true;
};
function Pong(clientTimeMs, serverTimeMs) {
  ServerMessage.call(this);
  this.clientTimeMs = clientTimeMs;
  this.serverTimeMs = serverTimeMs;
}
protoOf(Pong).qq = function () {
  return this.clientTimeMs;
};
protoOf(Pong).mq = function () {
  return this.serverTimeMs;
};
protoOf(Pong).i8 = function () {
  return this.clientTimeMs;
};
protoOf(Pong).j8 = function () {
  return this.serverTimeMs;
};
protoOf(Pong).rq = function (clientTimeMs, serverTimeMs) {
  return new Pong(clientTimeMs, serverTimeMs);
};
protoOf(Pong).copy = function (clientTimeMs, serverTimeMs, $super) {
  clientTimeMs = clientTimeMs === VOID ? this.clientTimeMs : clientTimeMs;
  serverTimeMs = serverTimeMs === VOID ? this.serverTimeMs : serverTimeMs;
  return $super === VOID ? this.rq(clientTimeMs, serverTimeMs) : $super.rq.call(this, clientTimeMs, serverTimeMs);
};
protoOf(Pong).toString = function () {
  return 'Pong(clientTimeMs=' + this.clientTimeMs + ', serverTimeMs=' + this.serverTimeMs + ')';
};
protoOf(Pong).hashCode = function () {
  var result = getNumberHashCode(this.clientTimeMs);
  result = imul(result, 31) + getNumberHashCode(this.serverTimeMs) | 0;
  return result;
};
protoOf(Pong).equals = function (other) {
  if (this === other)
    return true;
  if (!(other instanceof Pong))
    return false;
  if (!equals(this.clientTimeMs, other.clientTimeMs))
    return false;
  if (!equals(this.serverTimeMs, other.serverTimeMs))
    return false;
  return true;
};
function Companion_1() {
  Companion_instance_2 = this;
  var tmp = this;
  var tmp_0 = LazyThreadSafetyMode_PUBLICATION_getInstance();
  tmp.kq_1 = lazy(tmp_0, ServerMessage$Companion$_anonymous__tx1b3p);
}
protoOf(Companion_1).sq = function () {
  return _get_$cachedSerializer__te6jhj(this);
};
var Companion_instance_2;
function Companion_getInstance_1() {
  if (Companion_instance_2 == null)
    new Companion_1();
  return Companion_instance_2;
}
function ServerMessage_init_$Init$(seen0, serializationConstructorMarker, $this) {
  return $this;
}
function ServerMessage() {
  Companion_getInstance_1();
}
function Companion_2() {
}
var Companion_instance_3;
function Companion_getInstance_2() {
  return Companion_instance_3;
}
function $serializer_1() {
  $serializer_instance_1 = this;
  var tmp0_serialDesc = new PluginGeneratedSerialDescriptor('ping', this, 1);
  tmp0_serialDesc.ie('clientTimeMs', false);
  this.tq_1 = tmp0_serialDesc;
}
protoOf($serializer_1).uq = function (encoder, value) {
  var tmp0_desc = this.tq_1;
  var tmp1_output = encoder.fc(tmp0_desc);
  tmp1_output.vc(tmp0_desc, 0, value.clientTimeMs);
  tmp1_output.gc(tmp0_desc);
};
protoOf($serializer_1).t9 = function (encoder, value) {
  return this.uq(encoder, value instanceof Ping ? value : THROW_CCE());
};
protoOf($serializer_1).u9 = function (decoder) {
  var tmp0_desc = this.tq_1;
  var tmp1_flag = true;
  var tmp2_index = 0;
  var tmp3_bitMask0 = 0;
  var tmp4_local0 = 0.0;
  var tmp5_input = decoder.fc(tmp0_desc);
  if (tmp5_input.nc()) {
    tmp4_local0 = tmp5_input.ic(tmp0_desc, 0);
    tmp3_bitMask0 = tmp3_bitMask0 | 1;
  } else
    while (tmp1_flag) {
      tmp2_index = tmp5_input.oc(tmp0_desc);
      switch (tmp2_index) {
        case -1:
          tmp1_flag = false;
          break;
        case 0:
          tmp4_local0 = tmp5_input.ic(tmp0_desc, 0);
          tmp3_bitMask0 = tmp3_bitMask0 | 1;
          break;
        default:
          throw UnknownFieldException_init_$Create$(tmp2_index);
      }
    }
  tmp5_input.gc(tmp0_desc);
  return Ping_init_$Create$(tmp3_bitMask0, tmp4_local0, null);
};
protoOf($serializer_1).s9 = function () {
  return this.tq_1;
};
protoOf($serializer_1).ke = function () {
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  return [DoubleSerializer_getInstance()];
};
var $serializer_instance_1;
function $serializer_getInstance_1() {
  if ($serializer_instance_1 == null)
    new $serializer_1();
  return $serializer_instance_1;
}
function Ping_init_$Init$(seen0, clientTimeMs, serializationConstructorMarker, $this) {
  if (!(1 === (1 & seen0))) {
    throwMissingFieldException(seen0, 1, $serializer_getInstance_1().tq_1);
  }
  ClientMessage_init_$Init$(seen0, serializationConstructorMarker, $this);
  $this.clientTimeMs = clientTimeMs;
  return $this;
}
function Ping_init_$Create$(seen0, clientTimeMs, serializationConstructorMarker) {
  return Ping_init_$Init$(seen0, clientTimeMs, serializationConstructorMarker, objectCreate(protoOf(Ping)));
}
function _get_$cachedSerializer__te6jhj_0($this) {
  return $this.vq_1.v();
}
function ClientMessage$Companion$_anonymous__4gwlcj() {
  var tmp = getKClass(ClientMessage);
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  var tmp_0 = [getKClass(Ping)];
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  var tmp_1 = [$serializer_getInstance_1()];
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  var tmp$ret$6 = [];
  return SealedClassSerializer_init_$Create$('app.spatialdesk.shared.ClientMessage', tmp, tmp_0, tmp_1, tmp$ret$6);
}
function Ping(clientTimeMs) {
  ClientMessage.call(this);
  this.clientTimeMs = clientTimeMs;
}
protoOf(Ping).qq = function () {
  return this.clientTimeMs;
};
protoOf(Ping).i8 = function () {
  return this.clientTimeMs;
};
protoOf(Ping).wq = function (clientTimeMs) {
  return new Ping(clientTimeMs);
};
protoOf(Ping).copy = function (clientTimeMs, $super) {
  clientTimeMs = clientTimeMs === VOID ? this.clientTimeMs : clientTimeMs;
  return $super === VOID ? this.wq(clientTimeMs) : $super.wq.call(this, clientTimeMs);
};
protoOf(Ping).toString = function () {
  return 'Ping(clientTimeMs=' + this.clientTimeMs + ')';
};
protoOf(Ping).hashCode = function () {
  return getNumberHashCode(this.clientTimeMs);
};
protoOf(Ping).equals = function (other) {
  if (this === other)
    return true;
  if (!(other instanceof Ping))
    return false;
  if (!equals(this.clientTimeMs, other.clientTimeMs))
    return false;
  return true;
};
function Companion_3() {
  Companion_instance_4 = this;
  var tmp = this;
  var tmp_0 = LazyThreadSafetyMode_PUBLICATION_getInstance();
  tmp.vq_1 = lazy(tmp_0, ClientMessage$Companion$_anonymous__4gwlcj);
}
protoOf(Companion_3).sq = function () {
  return _get_$cachedSerializer__te6jhj_0(this);
};
var Companion_instance_4;
function Companion_getInstance_3() {
  if (Companion_instance_4 == null)
    new Companion_3();
  return Companion_instance_4;
}
function ClientMessage_init_$Init$(seen0, serializationConstructorMarker, $this) {
  return $this;
}
function ClientMessage() {
  Companion_getInstance_3();
}
function Protocol() {
}
protoOf(Protocol).xq = function () {
  return 1;
};
protoOf(Protocol).encodeClient = function (message) {
  return get_ProtocolJson().dg(Companion_getInstance_3().sq(), message);
};
protoOf(Protocol).encodeServer = function (message) {
  return get_ProtocolJson().dg(Companion_getInstance_1().sq(), message);
};
protoOf(Protocol).decodeServer = function (json) {
  // Inline function 'kotlin.runCatching' call
  var tmp;
  try {
    // Inline function 'kotlin.Companion.success' call
    var value = get_ProtocolJson().eg(Companion_getInstance_1().sq(), json);
    tmp = _Result___init__impl__xyqfz8(value);
  } catch ($p) {
    var tmp_0;
    if ($p instanceof Error) {
      var e = $p;
      // Inline function 'kotlin.Companion.failure' call
      tmp_0 = _Result___init__impl__xyqfz8(createFailure(e));
    } else {
      throw $p;
    }
    tmp = tmp_0;
  }
  // Inline function 'kotlin.Result.getOrNull' call
  var this_0 = tmp;
  return _Result___get_isFailure__impl__jpiriv(this_0) ? null : _Result___get_value__impl__bjfvqg(this_0);
};
protoOf(Protocol).decodeClient = function (json) {
  // Inline function 'kotlin.runCatching' call
  var tmp;
  try {
    // Inline function 'kotlin.Companion.success' call
    var value = get_ProtocolJson().eg(Companion_getInstance_3().sq(), json);
    tmp = _Result___init__impl__xyqfz8(value);
  } catch ($p) {
    var tmp_0;
    if ($p instanceof Error) {
      var e = $p;
      // Inline function 'kotlin.Companion.failure' call
      tmp_0 = _Result___init__impl__xyqfz8(createFailure(e));
    } else {
      throw $p;
    }
    tmp = tmp_0;
  }
  // Inline function 'kotlin.Result.getOrNull' call
  var this_0 = tmp;
  return _Result___get_isFailure__impl__jpiriv(this_0) ? null : _Result___get_value__impl__bjfvqg(this_0);
};
protoOf(Protocol).ping = function (clientTimeMs) {
  return this.encodeClient(new Ping(clientTimeMs));
};
var Protocol_instance;
function Protocol_getInstance() {
  return Protocol_instance;
}
function ProtocolJson$lambda($this$Json) {
  _init_properties_Protocol_kt__345mx4();
  $this$Json.ch_1 = 'type';
  $this$Json.xg_1 = true;
  $this$Json.vg_1 = true;
  return Unit_instance;
}
var properties_initialized_Protocol_kt_14ecii;
function _init_properties_Protocol_kt__345mx4() {
  if (!properties_initialized_Protocol_kt_14ecii) {
    properties_initialized_Protocol_kt_14ecii = true;
    ProtocolJson = Json(VOID, ProtocolJson$lambda);
  }
}
//region block: post-declaration
defineProp(protoOf(ClockSync), 'synced', protoOf(ClockSync).fq);
protoOf($serializer).le = typeParametersSerializers;
protoOf($serializer_0).le = typeParametersSerializers;
protoOf($serializer_1).le = typeParametersSerializers;
defineProp(protoOf(Protocol), 'version', protoOf(Protocol).xq);
//endregion
//region block: init
Companion_instance_0 = new Companion();
Companion_instance_1 = new Companion_0();
Companion_instance_3 = new Companion_2();
Protocol_instance = new Protocol();
//endregion
//region block: exports
ServerMessage.Hello = Hello;
ServerMessage.Pong = Pong;
ClientMessage.Ping = Ping;
var Protocol_0 = {getInstance: Protocol_getInstance};
export {
  ClockSync as ClockSync,
  ServerMessage as ServerMessage,
  ClientMessage as ClientMessage,
  Protocol_0 as Protocol,
};
//endregion

//# sourceMappingURL=spatialdesk-shared.mjs.map
