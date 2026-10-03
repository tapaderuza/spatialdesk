import {
  protoOf180f3jzyo7rfj as protoOf,
  initMetadataForInterface1egvbzx539z91 as initMetadataForInterface,
  VOID3gxj6tk5isa35 as VOID,
  getKClassFromExpression348iqjl4fnx2f as getKClassFromExpression,
  asList2ho2pewtsfvv as asList,
  objectCreate1ve4bgxiu4x98 as objectCreate,
  Unit_instancev9v8hjid95df as Unit_instance,
  StringCompanionObject_instance1v0ht40fz3tq0 as StringCompanionObject_instance,
  initMetadataForClassbxx6q50dy2s7 as initMetadataForClass,
  emptyList1g2z5xcrvp2zy as emptyList,
  LazyThreadSafetyMode_PUBLICATION_getInstance3qslfm3vqg6y3 as LazyThreadSafetyMode_PUBLICATION_getInstance,
  lazy1261dae0bgscp as lazy,
  IllegalArgumentException_init_$Create$i4126l9nkbuo as IllegalArgumentException_init_$Create$,
  zip2suipyqmdw72q as zip,
  toMap1vec9topfei08 as toMap,
  LinkedHashMap_init_$Create$2tibire69n089 as LinkedHashMap_init_$Create$,
  toString1pkumu07cwy4m as toString,
  IllegalStateException_init_$Create$1h4bcfod21ri0 as IllegalStateException_init_$Create$,
  mapCapacity1h45rc3eh9p2l as mapCapacity,
  LinkedHashMap_init_$Create$1gzy1x4a46gd4 as LinkedHashMap_init_$Create$_0,
  KProperty1ca4yb4wlo496 as KProperty1,
  getPropertyCallableRef3hckxc0xueiaj as getPropertyCallableRef,
  THROW_CCE2g6jy02ryeudk as THROW_CCE,
  KtMap140uvy3s5zad8 as KtMap,
  isInterface3d6p8outrmvmk as isInterface,
  IllegalArgumentException_init_$Init$3lhsivc54sj92 as IllegalArgumentException_init_$Init$,
  captureStack1fzi4aczwc4hg as captureStack,
  IllegalArgumentException_init_$Init$2amn5b4061oz5 as IllegalArgumentException_init_$Init$_0,
  IllegalArgumentException_init_$Init$3515n0oxnx1e8 as IllegalArgumentException_init_$Init$_1,
  IllegalArgumentException2asla15b5jaob as IllegalArgumentException,
  isBlank1dvkhjjvox3p0 as isBlank,
  equals2au1ep9vhcato as equals,
  toList383f556t1dixk as toList,
  ArrayList_init_$Create$37gc04va6yfo2 as ArrayList_init_$Create$,
  HashSet_init_$Create$2w31ptb4ree5i as HashSet_init_$Create$,
  toHashSet1qrcsl3g8ugc8 as toHashSet,
  copyToArray2j022khrow2yi as copyToArray,
  toBooleanArray2u3qw7fjwsmuh as toBooleanArray,
  withIndex3s8q7w1g0hyfn as withIndex,
  collectionSizeOrDefault36dulx8yinfqm as collectionSizeOrDefault,
  ArrayList_init_$Create$2byt5m5yn22yy as ArrayList_init_$Create$_0,
  to2cs3ny02qtbcb as to,
  lazy2hsh8ze7j6ikd as lazy_0,
  contentEqualsaf55p28mnw74 as contentEquals,
  initMetadataForObject1cxne3s9w65el as initMetadataForObject,
  ensureNotNull1e947j3ixpazm as ensureNotNull,
  getStringHashCode26igk1bx568vk as getStringHashCode,
  longArray288a0fctlmjmj as longArray,
  initMetadataForCompanion1wyw17z38v6ac as initMetadataForCompanion,
  get_lastIndex1y2f6o9u8hnf7 as get_lastIndex,
  Long2qws0ah9gnpki as Long,
  shiftLeft1ck77p6vapyra as shiftLeft,
  bitwiseOr1ita6dahwp8zb as bitwiseOr,
  equalsLong28bsrfhwvd686 as equalsLong,
  invert3i8k5n0dd6oib as invert,
  countTrailingZeroBits1k55x07cygoff as countTrailingZeroBits,
  HashSet_init_$Create$2tl34j0v8rf2n as HashSet_init_$Create$_0,
  HashMap_init_$Create$9gwgc7kcvfl1 as HashMap_init_$Create$,
  booleanArray2jdug9b51huk7 as booleanArray,
  emptyMapr06gerzljqtm as emptyMap,
  contentHashCode2i020q5tbeh2s as contentHashCode,
  hashCodeq5arwsb9dgti as hashCode,
  until1jbpn0z3f8lbg as until,
  joinToString1cxrrlmo0chqs as joinToString,
  charSequenceLength3278n89t01tmv as charSequenceLength,
  lastOrNull1aq5oz189qoe1 as lastOrNull,
  get_lastIndex1yw0x4k50k51w as get_lastIndex_0,
  noWhenBranchMatchedException2a6r7ubxgky5j as noWhenBranchMatchedException,
  KClass1cc9rfeybg8hs as KClass,
  get_indicesc04v40g017hw as get_indices,
  IndexOutOfBoundsException_init_$Create$3tkfni2s7f1n7 as IndexOutOfBoundsException_init_$Create$,
  get_indices377latqcai313 as get_indices_0,
} from './kotlin-kotlin-stdlib.mjs';
//region block: imports
var imul = Math.imul;
//endregion
//region block: pre-declaration
initMetadataForInterface(SerializationStrategy, 'SerializationStrategy');
initMetadataForInterface(DeserializationStrategy, 'DeserializationStrategy');
initMetadataForInterface(KSerializer, 'KSerializer', VOID, VOID, [SerializationStrategy, DeserializationStrategy]);
initMetadataForClass(SealedClassSerializer$$inlined$groupingBy$1);
initMetadataForClass(AbstractPolymorphicSerializer, 'AbstractPolymorphicSerializer', VOID, VOID, [KSerializer]);
initMetadataForClass(SealedClassSerializer, 'SealedClassSerializer', VOID, AbstractPolymorphicSerializer);
initMetadataForClass(SerializationException, 'SerializationException', SerializationException_init_$Create$, IllegalArgumentException);
initMetadataForClass(UnknownFieldException, 'UnknownFieldException', VOID, SerializationException);
initMetadataForClass(MissingFieldException, 'MissingFieldException', VOID, SerializationException);
function get_isNullable() {
  return false;
}
function get_isInline() {
  return false;
}
function get_annotations() {
  return emptyList();
}
initMetadataForInterface(SerialDescriptor, 'SerialDescriptor');
initMetadataForClass(ContextDescriptor, 'ContextDescriptor', VOID, VOID, [SerialDescriptor]);
initMetadataForClass(elementDescriptors$1);
initMetadataForClass(elementDescriptors$$inlined$Iterable$1);
initMetadataForClass(ClassSerialDescriptorBuilder, 'ClassSerialDescriptorBuilder');
initMetadataForInterface(CachedNames, 'CachedNames');
initMetadataForClass(SerialDescriptorImpl, 'SerialDescriptorImpl', VOID, VOID, [SerialDescriptor, CachedNames]);
initMetadataForClass(SerialKind, 'SerialKind');
initMetadataForObject(ENUM, 'ENUM', VOID, SerialKind);
initMetadataForObject(CONTEXTUAL, 'CONTEXTUAL', VOID, SerialKind);
initMetadataForClass(StructureKind, 'StructureKind', VOID, SerialKind);
initMetadataForObject(CLASS, 'CLASS', VOID, StructureKind);
initMetadataForObject(LIST, 'LIST', VOID, StructureKind);
initMetadataForObject(MAP, 'MAP', VOID, StructureKind);
initMetadataForObject(OBJECT, 'OBJECT', VOID, StructureKind);
initMetadataForClass(PrimitiveKind, 'PrimitiveKind', VOID, SerialKind);
initMetadataForObject(INT, 'INT', VOID, PrimitiveKind);
initMetadataForObject(DOUBLE, 'DOUBLE', VOID, PrimitiveKind);
initMetadataForObject(STRING, 'STRING', VOID, PrimitiveKind);
initMetadataForClass(PolymorphicKind, 'PolymorphicKind', VOID, SerialKind);
initMetadataForObject(SEALED, 'SEALED', VOID, PolymorphicKind);
function decodeSerializableValue(deserializer) {
  return deserializer.u9(this);
}
initMetadataForInterface(Decoder, 'Decoder');
function decodeSequentially() {
  return false;
}
function decodeSerializableElement$default(descriptor, index, deserializer, previousValue, $super) {
  previousValue = previousValue === VOID ? null : previousValue;
  return $super === VOID ? this.kc(descriptor, index, deserializer, previousValue) : $super.kc.call(this, descriptor, index, deserializer, previousValue);
}
initMetadataForInterface(CompositeDecoder, 'CompositeDecoder');
initMetadataForClass(AbstractDecoder, 'AbstractDecoder', VOID, VOID, [Decoder, CompositeDecoder]);
function encodeSerializableValue(serializer, value) {
  serializer.t9(this, value);
}
initMetadataForInterface(Encoder, 'Encoder');
initMetadataForClass(AbstractEncoder, 'AbstractEncoder', VOID, VOID, [Encoder]);
initMetadataForCompanion(Companion);
initMetadataForClass(ElementMarker, 'ElementMarker');
initMetadataForClass(PluginGeneratedSerialDescriptor, 'PluginGeneratedSerialDescriptor', VOID, VOID, [SerialDescriptor, CachedNames]);
initMetadataForClass(InlineClassDescriptor, 'InlineClassDescriptor', VOID, PluginGeneratedSerialDescriptor);
function typeParametersSerializers() {
  return get_EMPTY_SERIALIZER_ARRAY();
}
initMetadataForInterface(GeneratedSerializer, 'GeneratedSerializer', VOID, VOID, [KSerializer]);
initMetadataForClass(InlinePrimitiveDescriptor$1, VOID, VOID, VOID, [GeneratedSerializer]);
initMetadataForClass(SerialDescriptorForNullable, 'SerialDescriptorForNullable', VOID, VOID, [SerialDescriptor, CachedNames]);
initMetadataForObject(StringSerializer, 'StringSerializer', VOID, VOID, [KSerializer]);
initMetadataForClass(PrimitiveSerialDescriptor, 'PrimitiveSerialDescriptor', VOID, VOID, [SerialDescriptor]);
initMetadataForObject(IntSerializer, 'IntSerializer', VOID, VOID, [KSerializer]);
initMetadataForObject(DoubleSerializer, 'DoubleSerializer', VOID, VOID, [KSerializer]);
initMetadataForClass(TaggedDecoder, 'TaggedDecoder', VOID, VOID, [Decoder, CompositeDecoder]);
initMetadataForClass(NamedValueDecoder, 'NamedValueDecoder', VOID, TaggedDecoder);
initMetadataForClass(SerializersModule, 'SerializersModule');
initMetadataForClass(SerialModuleImpl, 'SerialModuleImpl', VOID, SerializersModule);
initMetadataForClass(ContextualProvider, 'ContextualProvider');
initMetadataForClass(Argless, 'Argless', VOID, ContextualProvider);
initMetadataForClass(WithTypeArguments, 'WithTypeArguments', VOID, ContextualProvider);
function contextual(kClass, serializer) {
  return this.uf(kClass, SerializersModuleCollector$contextual$lambda(serializer));
}
initMetadataForInterface(SerializersModuleCollector, 'SerializersModuleCollector');
initMetadataForClass(SerializableWith, 'SerializableWith', VOID, VOID, VOID, VOID, 0);
//endregion
function KSerializer() {
}
function SerializationStrategy() {
}
function DeserializationStrategy() {
}
function findPolymorphicSerializer(_this__u8e3s4, encoder, value) {
  var tmp0_elvis_lhs = _this__u8e3s4.v9(encoder, value);
  var tmp;
  if (tmp0_elvis_lhs == null) {
    throwSubtypeNotRegistered(getKClassFromExpression(value), _this__u8e3s4.w9());
  } else {
    tmp = tmp0_elvis_lhs;
  }
  return tmp;
}
function findPolymorphicSerializer_0(_this__u8e3s4, decoder, klassName) {
  var tmp0_elvis_lhs = _this__u8e3s4.x9(decoder, klassName);
  var tmp;
  if (tmp0_elvis_lhs == null) {
    throwSubtypeNotRegistered_0(klassName, _this__u8e3s4.w9());
  } else {
    tmp = tmp0_elvis_lhs;
  }
  return tmp;
}
function SealedClassSerializer_init_$Init$(serialName, baseClass, subclasses, subclassSerializers, classAnnotations, $this) {
  SealedClassSerializer.call($this, serialName, baseClass, subclasses, subclassSerializers);
  $this.z9_1 = asList(classAnnotations);
  return $this;
}
function SealedClassSerializer_init_$Create$(serialName, baseClass, subclasses, subclassSerializers, classAnnotations) {
  return SealedClassSerializer_init_$Init$(serialName, baseClass, subclasses, subclassSerializers, classAnnotations, objectCreate(protoOf(SealedClassSerializer)));
}
function SealedClassSerializer$descriptor$delegate$lambda$lambda$lambda(this$0) {
  return function ($this$buildSerialDescriptor) {
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s = this$0.ca_1.z().i();
    while (_iterator__ex2g4s.j()) {
      var element = _iterator__ex2g4s.k();
      // Inline function 'kotlin.collections.component1' call
      var name = element.u();
      // Inline function 'kotlin.collections.component2' call
      var serializer = element.v();
      $this$buildSerialDescriptor.la(name, serializer.s9());
    }
    return Unit_instance;
  };
}
function SealedClassSerializer$descriptor$delegate$lambda$lambda(this$0) {
  return function ($this$buildSerialDescriptor) {
    $this$buildSerialDescriptor.la('type', serializer(StringCompanionObject_instance).s9());
    var tmp = 'kotlinx.serialization.Sealed<' + this$0.y9_1.g6() + '>';
    var tmp_0 = CONTEXTUAL_getInstance();
    var elementDescriptor = buildSerialDescriptor(tmp, tmp_0, [], SealedClassSerializer$descriptor$delegate$lambda$lambda$lambda(this$0));
    $this$buildSerialDescriptor.la('value', elementDescriptor);
    $this$buildSerialDescriptor.fa_1 = this$0.z9_1;
    return Unit_instance;
  };
}
function SealedClassSerializer$descriptor$delegate$lambda($serialName, this$0) {
  return function () {
    var tmp = SEALED_getInstance();
    return buildSerialDescriptor($serialName, tmp, [], SealedClassSerializer$descriptor$delegate$lambda$lambda(this$0));
  };
}
function SealedClassSerializer$_get_descriptor_$ref_m511rz() {
  return function (p0) {
    return p0.s9();
  };
}
function SealedClassSerializer$$inlined$groupingBy$1($this) {
  this.ma_1 = $this;
}
protoOf(SealedClassSerializer$$inlined$groupingBy$1).na = function () {
  return this.ma_1.i();
};
protoOf(SealedClassSerializer$$inlined$groupingBy$1).oa = function (element) {
  return element.v().s9().pa();
};
protoOf(SealedClassSerializer$$inlined$groupingBy$1).qa = function (element) {
  return this.oa(element);
};
function SealedClassSerializer(serialName, baseClass, subclasses, subclassSerializers) {
  AbstractPolymorphicSerializer.call(this);
  this.y9_1 = baseClass;
  this.z9_1 = emptyList();
  var tmp = this;
  var tmp_0 = LazyThreadSafetyMode_PUBLICATION_getInstance();
  tmp.aa_1 = lazy(tmp_0, SealedClassSerializer$descriptor$delegate$lambda(serialName, this));
  if (!(subclasses.length === subclassSerializers.length)) {
    throw IllegalArgumentException_init_$Create$('All subclasses of sealed class ' + this.y9_1.g6() + ' should be marked @Serializable');
  }
  this.ba_1 = toMap(zip(subclasses, subclassSerializers));
  var tmp_1 = this;
  // Inline function 'kotlin.collections.groupingBy' call
  var this_0 = this.ba_1.z();
  // Inline function 'kotlin.collections.aggregate' call
  var tmp0 = new SealedClassSerializer$$inlined$groupingBy$1(this_0);
  // Inline function 'kotlin.collections.mutableMapOf' call
  // Inline function 'kotlin.collections.aggregateTo' call
  var destination = LinkedHashMap_init_$Create$();
  // Inline function 'kotlin.collections.iterator' call
  var _iterator__ex2g4s = tmp0.na();
  while (_iterator__ex2g4s.j()) {
    var e = _iterator__ex2g4s.k();
    var key = tmp0.qa(e);
    var accumulator = destination.x(key);
    accumulator == null && !destination.w(key);
    if (!(accumulator == null)) {
      // Inline function 'kotlin.error' call
      var message = "Multiple sealed subclasses of '" + toString(this.y9_1) + "' have the same serial name '" + key + "':" + (" '" + toString(accumulator.u()) + "', '" + toString(e.u()) + "'");
      throw IllegalStateException_init_$Create$(toString(message));
    }
    // Inline function 'kotlin.collections.set' call
    destination.g2(key, e);
  }
  // Inline function 'kotlin.collections.mapValues' call
  // Inline function 'kotlin.collections.mapValuesTo' call
  var destination_0 = LinkedHashMap_init_$Create$_0(mapCapacity(destination.l()));
  // Inline function 'kotlin.collections.associateByTo' call
  var _iterator__ex2g4s_0 = destination.z().i();
  while (_iterator__ex2g4s_0.j()) {
    var element = _iterator__ex2g4s_0.k();
    var tmp_2 = element.u();
    var tmp$ret$12 = element.v().v();
    destination_0.g2(tmp_2, tmp$ret$12);
  }
  tmp_1.ca_1 = destination_0;
}
protoOf(SealedClassSerializer).w9 = function () {
  return this.y9_1;
};
protoOf(SealedClassSerializer).s9 = function () {
  var tmp0 = this.aa_1;
  var tmp = KProperty1;
  // Inline function 'kotlin.getValue' call
  getPropertyCallableRef('descriptor', 1, tmp, SealedClassSerializer$_get_descriptor_$ref_m511rz(), null);
  return tmp0.v();
};
protoOf(SealedClassSerializer).x9 = function (decoder, klassName) {
  // Inline function 'kotlin.collections.get' call
  var this_0 = this.ca_1;
  var tmp0_elvis_lhs = (isInterface(this_0, KtMap) ? this_0 : THROW_CCE()).x(klassName);
  return tmp0_elvis_lhs == null ? protoOf(AbstractPolymorphicSerializer).x9.call(this, decoder, klassName) : tmp0_elvis_lhs;
};
protoOf(SealedClassSerializer).v9 = function (encoder, value) {
  var tmp0_elvis_lhs = this.ba_1.x(getKClassFromExpression(value));
  var tmp1_safe_receiver = tmp0_elvis_lhs == null ? protoOf(AbstractPolymorphicSerializer).v9.call(this, encoder, value) : tmp0_elvis_lhs;
  var tmp;
  if (tmp1_safe_receiver == null) {
    tmp = null;
  } else {
    // Inline function 'kotlinx.serialization.internal.cast' call
    tmp = isInterface(tmp1_safe_receiver, SerializationStrategy) ? tmp1_safe_receiver : THROW_CCE();
  }
  return tmp;
};
function SerializationException_init_$Init$($this) {
  IllegalArgumentException_init_$Init$($this);
  SerializationException.call($this);
  return $this;
}
function SerializationException_init_$Create$() {
  var tmp = SerializationException_init_$Init$(objectCreate(protoOf(SerializationException)));
  captureStack(tmp, SerializationException_init_$Create$);
  return tmp;
}
function SerializationException_init_$Init$_0(message, $this) {
  IllegalArgumentException_init_$Init$_0(message, $this);
  SerializationException.call($this);
  return $this;
}
function SerializationException_init_$Create$_0(message) {
  var tmp = SerializationException_init_$Init$_0(message, objectCreate(protoOf(SerializationException)));
  captureStack(tmp, SerializationException_init_$Create$_0);
  return tmp;
}
function SerializationException_init_$Init$_1(message, cause, $this) {
  IllegalArgumentException_init_$Init$_1(message, cause, $this);
  SerializationException.call($this);
  return $this;
}
function SerializationException() {
  captureStack(this, SerializationException);
}
function UnknownFieldException_init_$Init$(index, $this) {
  UnknownFieldException.call($this, 'An unknown field for index ' + index);
  return $this;
}
function UnknownFieldException_init_$Create$(index) {
  var tmp = UnknownFieldException_init_$Init$(index, objectCreate(protoOf(UnknownFieldException)));
  captureStack(tmp, UnknownFieldException_init_$Create$);
  return tmp;
}
function UnknownFieldException(message) {
  SerializationException_init_$Init$_0(message, this);
  captureStack(this, UnknownFieldException);
}
function MissingFieldException_init_$Init$(missingFields, serialName, $this) {
  var tmp0_message = missingFields.l() === 1 ? "Field '" + missingFields.m(0) + "' is required for type with serial name '" + serialName + "', but it was missing" : 'Fields ' + toString(missingFields) + " are required for type with serial name '" + serialName + "', but they were missing";
  MissingFieldException.call($this, tmp0_message, null, missingFields, serialName);
  return $this;
}
function MissingFieldException_init_$Create$(missingFields, serialName) {
  var tmp = MissingFieldException_init_$Init$(missingFields, serialName, objectCreate(protoOf(MissingFieldException)));
  captureStack(tmp, MissingFieldException_init_$Create$);
  return tmp;
}
function MissingFieldException(message, cause, missingFields, serialName) {
  SerializationException_init_$Init$_1(message, cause, this);
  captureStack(this, MissingFieldException);
  this.sa_1 = missingFields;
  this.ta_1 = serialName;
}
protoOf(MissingFieldException).ua = function (newMessage) {
  return new MissingFieldException(newMessage, this, this.sa_1, this.ta_1);
};
function serializer(_this__u8e3s4) {
  return StringSerializer_getInstance();
}
function ContextDescriptor() {
}
function getContextualDescriptor(_this__u8e3s4, descriptor) {
  var tmp0_safe_receiver = get_capturedKClass(descriptor);
  var tmp;
  if (tmp0_safe_receiver == null) {
    tmp = null;
  } else {
    // Inline function 'kotlin.let' call
    var tmp0_safe_receiver_0 = _this__u8e3s4.va(tmp0_safe_receiver);
    tmp = tmp0_safe_receiver_0 == null ? null : tmp0_safe_receiver_0.s9();
  }
  return tmp;
}
function get_capturedKClass(_this__u8e3s4) {
  var tmp;
  if (_this__u8e3s4 instanceof ContextDescriptor) {
    tmp = _this__u8e3s4.xa_1;
  } else {
    if (_this__u8e3s4 instanceof SerialDescriptorForNullable) {
      tmp = get_capturedKClass(_this__u8e3s4.wa_1);
    } else {
      tmp = null;
    }
  }
  return tmp;
}
function SerialDescriptor() {
}
function get_elementDescriptors(_this__u8e3s4) {
  // Inline function 'kotlin.collections.Iterable' call
  return new elementDescriptors$$inlined$Iterable$1(_this__u8e3s4);
}
function elementDescriptors$1($this_elementDescriptors) {
  this.jb_1 = $this_elementDescriptors;
  this.ib_1 = $this_elementDescriptors.bb();
}
protoOf(elementDescriptors$1).j = function () {
  return this.ib_1 > 0;
};
protoOf(elementDescriptors$1).k = function () {
  var tmp = this.jb_1.bb();
  var _unary__edvuaz = this.ib_1;
  this.ib_1 = _unary__edvuaz - 1 | 0;
  return this.jb_1.gb(tmp - _unary__edvuaz | 0);
};
function elementDescriptors$$inlined$Iterable$1($this_elementDescriptors) {
  this.kb_1 = $this_elementDescriptors;
}
protoOf(elementDescriptors$$inlined$Iterable$1).i = function () {
  return new elementDescriptors$1(this.kb_1);
};
function buildSerialDescriptor(serialName, kind, typeParameters, builder) {
  var tmp;
  if (builder === VOID) {
    tmp = buildSerialDescriptor$lambda;
  } else {
    tmp = builder;
  }
  builder = tmp;
  // Inline function 'kotlin.text.isNotBlank' call
  // Inline function 'kotlin.require' call
  if (!!isBlank(serialName)) {
    var message = 'Blank serial names are prohibited';
    throw IllegalArgumentException_init_$Create$(toString(message));
  }
  // Inline function 'kotlin.require' call
  if (!!equals(kind, CLASS_getInstance())) {
    var message_0 = "For StructureKind.CLASS please use 'buildClassSerialDescriptor' instead";
    throw IllegalArgumentException_init_$Create$(toString(message_0));
  }
  var sdBuilder = new ClassSerialDescriptorBuilder(serialName);
  builder(sdBuilder);
  return new SerialDescriptorImpl(serialName, kind, sdBuilder.ga_1.l(), toList(typeParameters), sdBuilder);
}
function ClassSerialDescriptorBuilder(serialName) {
  this.da_1 = serialName;
  this.ea_1 = false;
  this.fa_1 = emptyList();
  this.ga_1 = ArrayList_init_$Create$();
  this.ha_1 = HashSet_init_$Create$();
  this.ia_1 = ArrayList_init_$Create$();
  this.ja_1 = ArrayList_init_$Create$();
  this.ka_1 = ArrayList_init_$Create$();
}
protoOf(ClassSerialDescriptorBuilder).lb = function (elementName, descriptor, annotations, isOptional) {
  // Inline function 'kotlin.require' call
  if (!this.ha_1.d(elementName)) {
    var message = "Element with name '" + elementName + "' is already registered in " + this.da_1;
    throw IllegalArgumentException_init_$Create$(toString(message));
  }
  // Inline function 'kotlin.collections.plusAssign' call
  this.ga_1.d(elementName);
  // Inline function 'kotlin.collections.plusAssign' call
  this.ia_1.d(descriptor);
  // Inline function 'kotlin.collections.plusAssign' call
  this.ja_1.d(annotations);
  // Inline function 'kotlin.collections.plusAssign' call
  this.ka_1.d(isOptional);
};
protoOf(ClassSerialDescriptorBuilder).la = function (elementName, descriptor, annotations, isOptional, $super) {
  annotations = annotations === VOID ? emptyList() : annotations;
  isOptional = isOptional === VOID ? false : isOptional;
  var tmp;
  if ($super === VOID) {
    this.lb(elementName, descriptor, annotations, isOptional);
    tmp = Unit_instance;
  } else {
    tmp = $super.lb.call(this, elementName, descriptor, annotations, isOptional);
  }
  return tmp;
};
function _get__hashCode__tgwhef($this) {
  var tmp0 = $this.xb_1;
  var tmp = KProperty1;
  // Inline function 'kotlin.getValue' call
  getPropertyCallableRef('_hashCode', 1, tmp, SerialDescriptorImpl$_get__hashCode_$ref_2v7wzp(), null);
  return tmp0.v();
}
function SerialDescriptorImpl$_hashCode$delegate$lambda(this$0) {
  return function () {
    return hashCodeImpl(this$0, this$0.wb_1);
  };
}
function SerialDescriptorImpl$_get__hashCode_$ref_2v7wzp() {
  return function (p0) {
    return _get__hashCode__tgwhef(p0);
  };
}
function SerialDescriptorImpl(serialName, kind, elementsCount, typeParameters, builder) {
  this.mb_1 = serialName;
  this.nb_1 = kind;
  this.ob_1 = elementsCount;
  this.pb_1 = builder.fa_1;
  this.qb_1 = toHashSet(builder.ga_1);
  var tmp = this;
  // Inline function 'kotlin.collections.toTypedArray' call
  var this_0 = builder.ga_1;
  tmp.rb_1 = copyToArray(this_0);
  this.sb_1 = compactArray(builder.ia_1);
  var tmp_0 = this;
  // Inline function 'kotlin.collections.toTypedArray' call
  var this_1 = builder.ja_1;
  tmp_0.tb_1 = copyToArray(this_1);
  this.ub_1 = toBooleanArray(builder.ka_1);
  var tmp_1 = this;
  // Inline function 'kotlin.collections.map' call
  var this_2 = withIndex(this.rb_1);
  // Inline function 'kotlin.collections.mapTo' call
  var destination = ArrayList_init_$Create$_0(collectionSizeOrDefault(this_2, 10));
  var _iterator__ex2g4s = this_2.i();
  while (_iterator__ex2g4s.j()) {
    var item = _iterator__ex2g4s.k();
    var tmp$ret$4 = to(item.y7_1, item.x7_1);
    destination.d(tmp$ret$4);
  }
  tmp_1.vb_1 = toMap(destination);
  this.wb_1 = compactArray(typeParameters);
  var tmp_2 = this;
  tmp_2.xb_1 = lazy_0(SerialDescriptorImpl$_hashCode$delegate$lambda(this));
}
protoOf(SerialDescriptorImpl).pa = function () {
  return this.mb_1;
};
protoOf(SerialDescriptorImpl).ya = function () {
  return this.nb_1;
};
protoOf(SerialDescriptorImpl).bb = function () {
  return this.ob_1;
};
protoOf(SerialDescriptorImpl).cb = function () {
  return this.pb_1;
};
protoOf(SerialDescriptorImpl).yb = function () {
  return this.qb_1;
};
protoOf(SerialDescriptorImpl).db = function (index) {
  return getChecked(this.rb_1, index);
};
protoOf(SerialDescriptorImpl).eb = function (name) {
  var tmp0_elvis_lhs = this.vb_1.x(name);
  return tmp0_elvis_lhs == null ? -3 : tmp0_elvis_lhs;
};
protoOf(SerialDescriptorImpl).fb = function (index) {
  return getChecked(this.tb_1, index);
};
protoOf(SerialDescriptorImpl).gb = function (index) {
  return getChecked(this.sb_1, index);
};
protoOf(SerialDescriptorImpl).hb = function (index) {
  return getChecked_0(this.ub_1, index);
};
protoOf(SerialDescriptorImpl).equals = function (other) {
  var tmp$ret$0;
  $l$block_5: {
    // Inline function 'kotlinx.serialization.internal.equalsImpl' call
    if (this === other) {
      tmp$ret$0 = true;
      break $l$block_5;
    }
    if (!(other instanceof SerialDescriptorImpl)) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    if (!(this.pa() === other.pa())) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    if (!contentEquals(this.wb_1, other.wb_1)) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    if (!(this.bb() === other.bb())) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    var inductionVariable = 0;
    var last = this.bb();
    if (inductionVariable < last)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        if (!(this.gb(index).pa() === other.gb(index).pa())) {
          tmp$ret$0 = false;
          break $l$block_5;
        }
        if (!equals(this.gb(index).ya(), other.gb(index).ya())) {
          tmp$ret$0 = false;
          break $l$block_5;
        }
      }
       while (inductionVariable < last);
    tmp$ret$0 = true;
  }
  return tmp$ret$0;
};
protoOf(SerialDescriptorImpl).hashCode = function () {
  return _get__hashCode__tgwhef(this);
};
protoOf(SerialDescriptorImpl).toString = function () {
  return toStringImpl(this);
};
function buildSerialDescriptor$lambda(_this__u8e3s4) {
  return Unit_instance;
}
function ENUM() {
  ENUM_instance = this;
  SerialKind.call(this);
}
var ENUM_instance;
function ENUM_getInstance() {
  if (ENUM_instance == null)
    new ENUM();
  return ENUM_instance;
}
function CONTEXTUAL() {
  CONTEXTUAL_instance = this;
  SerialKind.call(this);
}
var CONTEXTUAL_instance;
function CONTEXTUAL_getInstance() {
  if (CONTEXTUAL_instance == null)
    new CONTEXTUAL();
  return CONTEXTUAL_instance;
}
function SerialKind() {
}
protoOf(SerialKind).toString = function () {
  return ensureNotNull(getKClassFromExpression(this).g6());
};
protoOf(SerialKind).hashCode = function () {
  return getStringHashCode(this.toString());
};
function CLASS() {
  CLASS_instance = this;
  StructureKind.call(this);
}
var CLASS_instance;
function CLASS_getInstance() {
  if (CLASS_instance == null)
    new CLASS();
  return CLASS_instance;
}
function LIST() {
  LIST_instance = this;
  StructureKind.call(this);
}
var LIST_instance;
function LIST_getInstance() {
  if (LIST_instance == null)
    new LIST();
  return LIST_instance;
}
function MAP() {
  MAP_instance = this;
  StructureKind.call(this);
}
var MAP_instance;
function MAP_getInstance() {
  if (MAP_instance == null)
    new MAP();
  return MAP_instance;
}
function OBJECT() {
  OBJECT_instance = this;
  StructureKind.call(this);
}
var OBJECT_instance;
function OBJECT_getInstance() {
  if (OBJECT_instance == null)
    new OBJECT();
  return OBJECT_instance;
}
function StructureKind() {
  SerialKind.call(this);
}
function INT() {
  INT_instance = this;
  PrimitiveKind.call(this);
}
var INT_instance;
function INT_getInstance() {
  if (INT_instance == null)
    new INT();
  return INT_instance;
}
function DOUBLE() {
  DOUBLE_instance = this;
  PrimitiveKind.call(this);
}
var DOUBLE_instance;
function DOUBLE_getInstance() {
  if (DOUBLE_instance == null)
    new DOUBLE();
  return DOUBLE_instance;
}
function STRING() {
  STRING_instance = this;
  PrimitiveKind.call(this);
}
var STRING_instance;
function STRING_getInstance() {
  if (STRING_instance == null)
    new STRING();
  return STRING_instance;
}
function PrimitiveKind() {
  SerialKind.call(this);
}
function SEALED() {
  SEALED_instance = this;
  PolymorphicKind.call(this);
}
var SEALED_instance;
function SEALED_getInstance() {
  if (SEALED_instance == null)
    new SEALED();
  return SEALED_instance;
}
function PolymorphicKind() {
  SerialKind.call(this);
}
function AbstractDecoder() {
}
protoOf(AbstractDecoder).zb = function () {
  throw SerializationException_init_$Create$_0(toString(getKClassFromExpression(this)) + " can't retrieve untyped values");
};
protoOf(AbstractDecoder).ac = function () {
  var tmp = this.zb();
  return typeof tmp === 'number' ? tmp : THROW_CCE();
};
protoOf(AbstractDecoder).bc = function () {
  var tmp = this.zb();
  return typeof tmp === 'number' ? tmp : THROW_CCE();
};
protoOf(AbstractDecoder).cc = function () {
  var tmp = this.zb();
  return typeof tmp === 'string' ? tmp : THROW_CCE();
};
protoOf(AbstractDecoder).dc = function (deserializer, previousValue) {
  return this.ec(deserializer);
};
protoOf(AbstractDecoder).fc = function (descriptor) {
  return this;
};
protoOf(AbstractDecoder).gc = function (descriptor) {
};
protoOf(AbstractDecoder).hc = function (descriptor, index) {
  return this.ac();
};
protoOf(AbstractDecoder).ic = function (descriptor, index) {
  return this.bc();
};
protoOf(AbstractDecoder).jc = function (descriptor, index) {
  return this.cc();
};
protoOf(AbstractDecoder).kc = function (descriptor, index, deserializer, previousValue) {
  return this.dc(deserializer, previousValue);
};
function AbstractEncoder() {
}
protoOf(AbstractEncoder).fc = function (descriptor) {
  return this;
};
protoOf(AbstractEncoder).gc = function (descriptor) {
};
protoOf(AbstractEncoder).pc = function (descriptor, index) {
  return true;
};
protoOf(AbstractEncoder).qc = function (value) {
  throw SerializationException_init_$Create$_0('Non-serializable ' + toString(getKClassFromExpression(value)) + ' is not supported by ' + toString(getKClassFromExpression(this)) + ' encoder');
};
protoOf(AbstractEncoder).rc = function (value) {
  return this.qc(value);
};
protoOf(AbstractEncoder).sc = function (value) {
  return this.qc(value);
};
protoOf(AbstractEncoder).tc = function (value) {
  return this.qc(value);
};
protoOf(AbstractEncoder).uc = function (descriptor, index, value) {
  if (this.pc(descriptor, index)) {
    this.rc(value);
  }
};
protoOf(AbstractEncoder).vc = function (descriptor, index, value) {
  if (this.pc(descriptor, index)) {
    this.sc(value);
  }
};
protoOf(AbstractEncoder).wc = function (descriptor, index, value) {
  if (this.pc(descriptor, index)) {
    this.tc(value);
  }
};
protoOf(AbstractEncoder).xc = function (descriptor, index, serializer, value) {
  if (this.pc(descriptor, index)) {
    this.yc(serializer, value);
  }
};
function Decoder() {
}
function CompositeDecoder() {
}
function Encoder() {
}
function decodeSequentially_0($this, compositeDecoder) {
  var klassName = compositeDecoder.jc($this.s9(), 0);
  var serializer = findPolymorphicSerializer_0($this, compositeDecoder, klassName);
  return compositeDecoder.lc($this.s9(), 1, serializer);
}
function AbstractPolymorphicSerializer() {
}
protoOf(AbstractPolymorphicSerializer).ra = function (encoder, value) {
  var actualSerializer = findPolymorphicSerializer(this, encoder, value);
  // Inline function 'kotlinx.serialization.encoding.encodeStructure' call
  var descriptor = this.s9();
  var composite = encoder.fc(descriptor);
  composite.wc(this.s9(), 0, actualSerializer.s9().pa());
  var tmp = this.s9();
  // Inline function 'kotlinx.serialization.internal.cast' call
  var tmp$ret$2 = isInterface(actualSerializer, SerializationStrategy) ? actualSerializer : THROW_CCE();
  composite.xc(tmp, 1, tmp$ret$2, value);
  composite.gc(descriptor);
};
protoOf(AbstractPolymorphicSerializer).t9 = function (encoder, value) {
  return this.ra(encoder, !(value == null) ? value : THROW_CCE());
};
protoOf(AbstractPolymorphicSerializer).u9 = function (decoder) {
  // Inline function 'kotlinx.serialization.encoding.decodeStructure' call
  var descriptor = this.s9();
  var composite = decoder.fc(descriptor);
  var tmp$ret$1;
  $l$block: {
    var klassName = null;
    var value = null;
    if (composite.nc()) {
      tmp$ret$1 = decodeSequentially_0(this, composite);
      break $l$block;
    }
    mainLoop: while (true) {
      var index = composite.oc(this.s9());
      switch (index) {
        case -1:
          break mainLoop;
        case 0:
          klassName = composite.jc(this.s9(), index);
          break;
        case 1:
          var tmp0 = klassName;
          var tmp$ret$2;
          $l$block_0: {
            // Inline function 'kotlin.requireNotNull' call
            if (tmp0 == null) {
              var message = 'Cannot read polymorphic value before its type token';
              throw IllegalArgumentException_init_$Create$(toString(message));
            } else {
              tmp$ret$2 = tmp0;
              break $l$block_0;
            }
          }

          klassName = tmp$ret$2;
          var serializer = findPolymorphicSerializer_0(this, composite, klassName);
          value = composite.lc(this.s9(), index, serializer);
          break;
        default:
          var tmp0_elvis_lhs = klassName;
          throw SerializationException_init_$Create$_0('Invalid index in polymorphic deserialization of ' + (tmp0_elvis_lhs == null ? 'unknown class' : tmp0_elvis_lhs) + ('\n Expected 0, 1 or DECODE_DONE(-1), but found ' + index));
      }
    }
    var tmp0_0 = value;
    var tmp$ret$4;
    $l$block_1: {
      // Inline function 'kotlin.requireNotNull' call
      if (tmp0_0 == null) {
        var message_0 = 'Polymorphic value has not been read for class ' + klassName;
        throw IllegalArgumentException_init_$Create$(toString(message_0));
      } else {
        tmp$ret$4 = tmp0_0;
        break $l$block_1;
      }
    }
    var tmp = tmp$ret$4;
    tmp$ret$1 = !(tmp == null) ? tmp : THROW_CCE();
  }
  var result = tmp$ret$1;
  composite.gc(descriptor);
  return result;
};
protoOf(AbstractPolymorphicSerializer).x9 = function (decoder, klassName) {
  return decoder.mc().zc(this.w9(), klassName);
};
protoOf(AbstractPolymorphicSerializer).v9 = function (encoder, value) {
  return encoder.mc().ad(this.w9(), value);
};
function throwSubtypeNotRegistered(subClass, baseClass) {
  var tmp0_elvis_lhs = subClass.g6();
  throwSubtypeNotRegistered_0(tmp0_elvis_lhs == null ? toString(subClass) : tmp0_elvis_lhs, baseClass);
}
function throwSubtypeNotRegistered_0(subClassName, baseClass) {
  var scope = "in the polymorphic scope of '" + baseClass.g6() + "'";
  throw SerializationException_init_$Create$_0(subClassName == null ? 'Class discriminator was missing and no default serializers were registered ' + scope + '.' : "Serializer for subclass '" + subClassName + "' is not found " + scope + '.\n' + ("Check if class with serial name '" + subClassName + "' exists and serializer is registered in a corresponding SerializersModule.\n") + ("To be registered automatically, class '" + subClassName + "' has to be '@Serializable', and the base class '" + baseClass.g6() + "' has to be sealed and '@Serializable'."));
}
function CachedNames() {
}
function Companion() {
  Companion_instance = this;
  this.bd_1 = longArray(0);
}
var Companion_instance;
function Companion_getInstance() {
  if (Companion_instance == null)
    new Companion();
  return Companion_instance;
}
function prepareHighMarksArray($this, elementsCount) {
  var slotsCount = (elementsCount - 1 | 0) >>> 6 | 0;
  var elementsInLastSlot = elementsCount & 63;
  var highMarks = longArray(slotsCount);
  if (!(elementsInLastSlot === 0)) {
    highMarks[get_lastIndex(highMarks)] = shiftLeft(new Long(-1, -1), elementsCount);
  }
  return highMarks;
}
function markHigh($this, index) {
  var slot = (index >>> 6 | 0) - 1 | 0;
  var offsetInSlot = index & 63;
  $this.fd_1[slot] = bitwiseOr($this.fd_1[slot], shiftLeft(new Long(1, 0), offsetInSlot));
}
function nextUnmarkedHighIndex($this) {
  var inductionVariable = 0;
  var last = $this.fd_1.length - 1 | 0;
  if (inductionVariable <= last)
    do {
      var slot = inductionVariable;
      inductionVariable = inductionVariable + 1 | 0;
      var slotOffset = imul(slot + 1 | 0, 64);
      var slotMarks = $this.fd_1[slot];
      while (!equalsLong(slotMarks, new Long(-1, -1))) {
        var indexInSlot = countTrailingZeroBits(invert(slotMarks));
        slotMarks = bitwiseOr(slotMarks, shiftLeft(new Long(1, 0), indexInSlot));
        var index = slotOffset + indexInSlot | 0;
        if ($this.dd_1($this.cd_1, index)) {
          $this.fd_1[slot] = slotMarks;
          return index;
        }
      }
      $this.fd_1[slot] = slotMarks;
    }
     while (inductionVariable <= last);
  return -1;
}
function ElementMarker(descriptor, readIfAbsent) {
  Companion_getInstance();
  this.cd_1 = descriptor;
  this.dd_1 = readIfAbsent;
  var elementsCount = this.cd_1.bb();
  if (elementsCount <= 64) {
    var tmp = this;
    var tmp_0;
    if (elementsCount === 64) {
      tmp_0 = new Long(0, 0);
    } else {
      tmp_0 = shiftLeft(new Long(-1, -1), elementsCount);
    }
    tmp.ed_1 = tmp_0;
    this.fd_1 = Companion_getInstance().bd_1;
  } else {
    this.ed_1 = new Long(0, 0);
    this.fd_1 = prepareHighMarksArray(this, elementsCount);
  }
}
protoOf(ElementMarker).gd = function (index) {
  if (index < 64) {
    this.ed_1 = bitwiseOr(this.ed_1, shiftLeft(new Long(1, 0), index));
  } else {
    markHigh(this, index);
  }
};
protoOf(ElementMarker).hd = function () {
  var elementsCount = this.cd_1.bb();
  while (!equalsLong(this.ed_1, new Long(-1, -1))) {
    var index = countTrailingZeroBits(invert(this.ed_1));
    this.ed_1 = bitwiseOr(this.ed_1, shiftLeft(new Long(1, 0), index));
    if (this.dd_1(this.cd_1, index)) {
      return index;
    }
  }
  if (elementsCount > 64) {
    return nextUnmarkedHighIndex(this);
  }
  return -1;
};
function InlinePrimitiveDescriptor(name, primitiveSerializer) {
  return new InlineClassDescriptor(name, new InlinePrimitiveDescriptor$1(primitiveSerializer));
}
function InlineClassDescriptor(name, generatedSerializer) {
  PluginGeneratedSerialDescriptor.call(this, name, generatedSerializer, 1);
  this.ud_1 = true;
}
protoOf(InlineClassDescriptor).ab = function () {
  return this.ud_1;
};
protoOf(InlineClassDescriptor).hashCode = function () {
  return imul(protoOf(PluginGeneratedSerialDescriptor).hashCode.call(this), 31);
};
protoOf(InlineClassDescriptor).equals = function (other) {
  var tmp$ret$0;
  $l$block_5: {
    // Inline function 'kotlinx.serialization.internal.equalsImpl' call
    if (this === other) {
      tmp$ret$0 = true;
      break $l$block_5;
    }
    if (!(other instanceof InlineClassDescriptor)) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    if (!(this.pa() === other.pa())) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    if (!(other.ud_1 && contentEquals(this.he(), other.he()))) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    if (!(this.bb() === other.bb())) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    var inductionVariable = 0;
    var last = this.bb();
    if (inductionVariable < last)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        if (!(this.gb(index).pa() === other.gb(index).pa())) {
          tmp$ret$0 = false;
          break $l$block_5;
        }
        if (!equals(this.gb(index).ya(), other.gb(index).ya())) {
          tmp$ret$0 = false;
          break $l$block_5;
        }
      }
       while (inductionVariable < last);
    tmp$ret$0 = true;
  }
  return tmp$ret$0;
};
function InlinePrimitiveDescriptor$1($primitiveSerializer) {
  this.je_1 = $primitiveSerializer;
}
protoOf(InlinePrimitiveDescriptor$1).ke = function () {
  // Inline function 'kotlin.arrayOf' call
  // Inline function 'kotlin.js.unsafeCast' call
  // Inline function 'kotlin.js.asDynamic' call
  return [this.je_1];
};
protoOf(InlinePrimitiveDescriptor$1).s9 = function () {
  // Inline function 'kotlin.error' call
  var message = 'unsupported';
  throw IllegalStateException_init_$Create$(toString(message));
};
protoOf(InlinePrimitiveDescriptor$1).t9 = function (encoder, value) {
  // Inline function 'kotlin.error' call
  var message = 'unsupported';
  throw IllegalStateException_init_$Create$(toString(message));
};
protoOf(InlinePrimitiveDescriptor$1).u9 = function (decoder) {
  // Inline function 'kotlin.error' call
  var message = 'unsupported';
  throw IllegalStateException_init_$Create$(toString(message));
};
function missingFieldExceptionWithNewMessage(exception, message) {
  return exception.ua(message);
}
function jsonCachedSerialNames(_this__u8e3s4) {
  return cachedSerialNames(_this__u8e3s4);
}
function SerialDescriptorForNullable() {
}
function get_EMPTY_DESCRIPTOR_ARRAY() {
  _init_properties_Platform_common_kt__3qzecs();
  return EMPTY_DESCRIPTOR_ARRAY;
}
var EMPTY_DESCRIPTOR_ARRAY;
function cachedSerialNames(_this__u8e3s4) {
  _init_properties_Platform_common_kt__3qzecs();
  if (isInterface(_this__u8e3s4, CachedNames))
    return _this__u8e3s4.yb();
  var result = HashSet_init_$Create$_0(_this__u8e3s4.bb());
  var inductionVariable = 0;
  var last = _this__u8e3s4.bb();
  if (inductionVariable < last)
    do {
      var i = inductionVariable;
      inductionVariable = inductionVariable + 1 | 0;
      // Inline function 'kotlin.collections.plusAssign' call
      var element = _this__u8e3s4.db(i);
      result.d(element);
    }
     while (inductionVariable < last);
  return result;
}
function compactArray(_this__u8e3s4) {
  _init_properties_Platform_common_kt__3qzecs();
  // Inline function 'kotlin.takeUnless' call
  var tmp;
  // Inline function 'kotlin.collections.isNullOrEmpty' call
  if (!(_this__u8e3s4 == null || _this__u8e3s4.n())) {
    tmp = _this__u8e3s4;
  } else {
    tmp = null;
  }
  var tmp0_safe_receiver = tmp;
  var tmp_0;
  if (tmp0_safe_receiver == null) {
    tmp_0 = null;
  } else {
    // Inline function 'kotlin.collections.toTypedArray' call
    tmp_0 = copyToArray(tmp0_safe_receiver);
  }
  var tmp1_elvis_lhs = tmp_0;
  return tmp1_elvis_lhs == null ? get_EMPTY_DESCRIPTOR_ARRAY() : tmp1_elvis_lhs;
}
var properties_initialized_Platform_common_kt_i7q4ty;
function _init_properties_Platform_common_kt__3qzecs() {
  if (!properties_initialized_Platform_common_kt_i7q4ty) {
    properties_initialized_Platform_common_kt_i7q4ty = true;
    // Inline function 'kotlin.arrayOf' call
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.js.asDynamic' call
    EMPTY_DESCRIPTOR_ARRAY = [];
  }
}
function throwMissingFieldException(seen, goldenMask, descriptor) {
  // Inline function 'kotlin.collections.mutableListOf' call
  var missingFields = ArrayList_init_$Create$();
  var missingFieldsBits = goldenMask & ~seen;
  var inductionVariable = 0;
  if (inductionVariable < 32)
    do {
      var i = inductionVariable;
      inductionVariable = inductionVariable + 1 | 0;
      if (!((missingFieldsBits & 1) === 0)) {
        // Inline function 'kotlin.collections.plusAssign' call
        var element = descriptor.db(i);
        missingFields.d(element);
      }
      missingFieldsBits = missingFieldsBits >>> 1 | 0;
    }
     while (inductionVariable < 32);
  throw MissingFieldException_init_$Create$(missingFields, descriptor.pa());
}
function _get_childSerializers__7vnyfa($this) {
  var tmp0 = $this.ee_1;
  var tmp = KProperty1;
  // Inline function 'kotlin.getValue' call
  getPropertyCallableRef('childSerializers', 1, tmp, PluginGeneratedSerialDescriptor$_get_childSerializers_$ref_e7suca(), null);
  return tmp0.v();
}
function _get__hashCode__tgwhef_0($this) {
  var tmp0 = $this.ge_1;
  var tmp = KProperty1;
  // Inline function 'kotlin.getValue' call
  getPropertyCallableRef('_hashCode', 1, tmp, PluginGeneratedSerialDescriptor$_get__hashCode_$ref_cmj4vz(), null);
  return tmp0.v();
}
function buildIndices($this) {
  var indices = HashMap_init_$Create$();
  var inductionVariable = 0;
  var last = $this.zd_1.length - 1 | 0;
  if (inductionVariable <= last)
    do {
      var i = inductionVariable;
      inductionVariable = inductionVariable + 1 | 0;
      // Inline function 'kotlin.collections.set' call
      var key = $this.zd_1[i];
      indices.g2(key, i);
    }
     while (inductionVariable <= last);
  return indices;
}
function PluginGeneratedSerialDescriptor$childSerializers$delegate$lambda(this$0) {
  return function () {
    var tmp0_safe_receiver = this$0.wd_1;
    var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.ke();
    return tmp1_elvis_lhs == null ? get_EMPTY_SERIALIZER_ARRAY() : tmp1_elvis_lhs;
  };
}
function PluginGeneratedSerialDescriptor$_get_childSerializers_$ref_e7suca() {
  return function (p0) {
    return _get_childSerializers__7vnyfa(p0);
  };
}
function PluginGeneratedSerialDescriptor$typeParameterDescriptors$delegate$lambda(this$0) {
  return function () {
    var tmp0_safe_receiver = this$0.wd_1;
    var tmp1_safe_receiver = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.le();
    var tmp;
    if (tmp1_safe_receiver == null) {
      tmp = null;
    } else {
      // Inline function 'kotlin.collections.map' call
      // Inline function 'kotlin.collections.mapTo' call
      var destination = ArrayList_init_$Create$_0(tmp1_safe_receiver.length);
      var inductionVariable = 0;
      var last = tmp1_safe_receiver.length;
      while (inductionVariable < last) {
        var item = tmp1_safe_receiver[inductionVariable];
        inductionVariable = inductionVariable + 1 | 0;
        var tmp$ret$2 = item.s9();
        destination.d(tmp$ret$2);
      }
      tmp = destination;
    }
    return compactArray(tmp);
  };
}
function PluginGeneratedSerialDescriptor$_get_typeParameterDescriptors_$ref_jk3pka() {
  return function (p0) {
    return p0.he();
  };
}
function PluginGeneratedSerialDescriptor$_hashCode$delegate$lambda(this$0) {
  return function () {
    return hashCodeImpl(this$0, this$0.he());
  };
}
function PluginGeneratedSerialDescriptor$_get__hashCode_$ref_cmj4vz() {
  return function (p0) {
    return _get__hashCode__tgwhef_0(p0);
  };
}
function PluginGeneratedSerialDescriptor(serialName, generatedSerializer, elementsCount) {
  generatedSerializer = generatedSerializer === VOID ? null : generatedSerializer;
  this.vd_1 = serialName;
  this.wd_1 = generatedSerializer;
  this.xd_1 = elementsCount;
  this.yd_1 = -1;
  var tmp = this;
  var tmp_0 = 0;
  var tmp_1 = this.xd_1;
  // Inline function 'kotlin.arrayOfNulls' call
  var tmp_2 = Array(tmp_1);
  while (tmp_0 < tmp_1) {
    tmp_2[tmp_0] = '[UNINITIALIZED]';
    tmp_0 = tmp_0 + 1 | 0;
  }
  tmp.zd_1 = tmp_2;
  var tmp_3 = this;
  // Inline function 'kotlin.arrayOfNulls' call
  var size = this.xd_1;
  tmp_3.ae_1 = Array(size);
  this.be_1 = null;
  this.ce_1 = booleanArray(this.xd_1);
  this.de_1 = emptyMap();
  var tmp_4 = this;
  var tmp_5 = LazyThreadSafetyMode_PUBLICATION_getInstance();
  tmp_4.ee_1 = lazy(tmp_5, PluginGeneratedSerialDescriptor$childSerializers$delegate$lambda(this));
  var tmp_6 = this;
  var tmp_7 = LazyThreadSafetyMode_PUBLICATION_getInstance();
  tmp_6.fe_1 = lazy(tmp_7, PluginGeneratedSerialDescriptor$typeParameterDescriptors$delegate$lambda(this));
  var tmp_8 = this;
  var tmp_9 = LazyThreadSafetyMode_PUBLICATION_getInstance();
  tmp_8.ge_1 = lazy(tmp_9, PluginGeneratedSerialDescriptor$_hashCode$delegate$lambda(this));
}
protoOf(PluginGeneratedSerialDescriptor).pa = function () {
  return this.vd_1;
};
protoOf(PluginGeneratedSerialDescriptor).bb = function () {
  return this.xd_1;
};
protoOf(PluginGeneratedSerialDescriptor).ya = function () {
  return CLASS_getInstance();
};
protoOf(PluginGeneratedSerialDescriptor).cb = function () {
  var tmp0_elvis_lhs = this.be_1;
  return tmp0_elvis_lhs == null ? emptyList() : tmp0_elvis_lhs;
};
protoOf(PluginGeneratedSerialDescriptor).yb = function () {
  return this.de_1.y();
};
protoOf(PluginGeneratedSerialDescriptor).he = function () {
  var tmp0 = this.fe_1;
  var tmp = KProperty1;
  // Inline function 'kotlin.getValue' call
  getPropertyCallableRef('typeParameterDescriptors', 1, tmp, PluginGeneratedSerialDescriptor$_get_typeParameterDescriptors_$ref_jk3pka(), null);
  return tmp0.v();
};
protoOf(PluginGeneratedSerialDescriptor).ie = function (name, isOptional) {
  this.yd_1 = this.yd_1 + 1 | 0;
  this.zd_1[this.yd_1] = name;
  this.ce_1[this.yd_1] = isOptional;
  this.ae_1[this.yd_1] = null;
  if (this.yd_1 === (this.xd_1 - 1 | 0)) {
    this.de_1 = buildIndices(this);
  }
};
protoOf(PluginGeneratedSerialDescriptor).gb = function (index) {
  return getChecked(_get_childSerializers__7vnyfa(this), index).s9();
};
protoOf(PluginGeneratedSerialDescriptor).hb = function (index) {
  return getChecked_0(this.ce_1, index);
};
protoOf(PluginGeneratedSerialDescriptor).fb = function (index) {
  var tmp0_elvis_lhs = getChecked(this.ae_1, index);
  return tmp0_elvis_lhs == null ? emptyList() : tmp0_elvis_lhs;
};
protoOf(PluginGeneratedSerialDescriptor).db = function (index) {
  return getChecked(this.zd_1, index);
};
protoOf(PluginGeneratedSerialDescriptor).eb = function (name) {
  var tmp0_elvis_lhs = this.de_1.x(name);
  return tmp0_elvis_lhs == null ? -3 : tmp0_elvis_lhs;
};
protoOf(PluginGeneratedSerialDescriptor).equals = function (other) {
  var tmp$ret$0;
  $l$block_5: {
    // Inline function 'kotlinx.serialization.internal.equalsImpl' call
    if (this === other) {
      tmp$ret$0 = true;
      break $l$block_5;
    }
    if (!(other instanceof PluginGeneratedSerialDescriptor)) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    if (!(this.pa() === other.pa())) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    if (!contentEquals(this.he(), other.he())) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    if (!(this.bb() === other.bb())) {
      tmp$ret$0 = false;
      break $l$block_5;
    }
    var inductionVariable = 0;
    var last = this.bb();
    if (inductionVariable < last)
      do {
        var index = inductionVariable;
        inductionVariable = inductionVariable + 1 | 0;
        if (!(this.gb(index).pa() === other.gb(index).pa())) {
          tmp$ret$0 = false;
          break $l$block_5;
        }
        if (!equals(this.gb(index).ya(), other.gb(index).ya())) {
          tmp$ret$0 = false;
          break $l$block_5;
        }
      }
       while (inductionVariable < last);
    tmp$ret$0 = true;
  }
  return tmp$ret$0;
};
protoOf(PluginGeneratedSerialDescriptor).hashCode = function () {
  return _get__hashCode__tgwhef_0(this);
};
protoOf(PluginGeneratedSerialDescriptor).toString = function () {
  return toStringImpl(this);
};
function hashCodeImpl(_this__u8e3s4, typeParams) {
  var result = getStringHashCode(_this__u8e3s4.pa());
  result = imul(31, result) + contentHashCode(typeParams) | 0;
  var elementDescriptors = get_elementDescriptors(_this__u8e3s4);
  // Inline function 'kotlinx.serialization.internal.elementsHashCodeBy' call
  // Inline function 'kotlin.collections.fold' call
  var accumulator = 1;
  var _iterator__ex2g4s = elementDescriptors.i();
  while (_iterator__ex2g4s.j()) {
    var element = _iterator__ex2g4s.k();
    var hash = accumulator;
    var tmp = imul(31, hash);
    // Inline function 'kotlin.hashCode' call
    var tmp0_safe_receiver = element.pa();
    var tmp1_elvis_lhs = tmp0_safe_receiver == null ? null : hashCode(tmp0_safe_receiver);
    accumulator = tmp + (tmp1_elvis_lhs == null ? 0 : tmp1_elvis_lhs) | 0;
  }
  var namesHash = accumulator;
  // Inline function 'kotlinx.serialization.internal.elementsHashCodeBy' call
  // Inline function 'kotlin.collections.fold' call
  var accumulator_0 = 1;
  var _iterator__ex2g4s_0 = elementDescriptors.i();
  while (_iterator__ex2g4s_0.j()) {
    var element_0 = _iterator__ex2g4s_0.k();
    var hash_0 = accumulator_0;
    var tmp_0 = imul(31, hash_0);
    // Inline function 'kotlin.hashCode' call
    var tmp0_safe_receiver_0 = element_0.ya();
    var tmp1_elvis_lhs_0 = tmp0_safe_receiver_0 == null ? null : hashCode(tmp0_safe_receiver_0);
    accumulator_0 = tmp_0 + (tmp1_elvis_lhs_0 == null ? 0 : tmp1_elvis_lhs_0) | 0;
  }
  var kindHash = accumulator_0;
  result = imul(31, result) + namesHash | 0;
  result = imul(31, result) + kindHash | 0;
  return result;
}
function toStringImpl(_this__u8e3s4) {
  var tmp = until(0, _this__u8e3s4.bb());
  var tmp_0 = _this__u8e3s4.pa() + '(';
  return joinToString(tmp, ', ', tmp_0, ')', VOID, VOID, toStringImpl$lambda(_this__u8e3s4));
}
function toStringImpl$lambda($this_toStringImpl) {
  return function (i) {
    return $this_toStringImpl.db(i) + ': ' + $this_toStringImpl.gb(i).pa();
  };
}
function get_EMPTY_SERIALIZER_ARRAY() {
  _init_properties_PluginHelperInterfaces_kt__xgvzfp();
  return EMPTY_SERIALIZER_ARRAY;
}
var EMPTY_SERIALIZER_ARRAY;
function GeneratedSerializer() {
}
var properties_initialized_PluginHelperInterfaces_kt_ap8in1;
function _init_properties_PluginHelperInterfaces_kt__xgvzfp() {
  if (!properties_initialized_PluginHelperInterfaces_kt_ap8in1) {
    properties_initialized_PluginHelperInterfaces_kt_ap8in1 = true;
    // Inline function 'kotlin.arrayOf' call
    // Inline function 'kotlin.js.unsafeCast' call
    // Inline function 'kotlin.js.asDynamic' call
    EMPTY_SERIALIZER_ARRAY = [];
  }
}
function StringSerializer() {
  StringSerializer_instance = this;
  this.me_1 = new PrimitiveSerialDescriptor('kotlin.String', STRING_getInstance());
}
protoOf(StringSerializer).s9 = function () {
  return this.me_1;
};
protoOf(StringSerializer).ne = function (encoder, value) {
  return encoder.tc(value);
};
protoOf(StringSerializer).t9 = function (encoder, value) {
  return this.ne(encoder, (!(value == null) ? typeof value === 'string' : false) ? value : THROW_CCE());
};
protoOf(StringSerializer).u9 = function (decoder) {
  return decoder.cc();
};
var StringSerializer_instance;
function StringSerializer_getInstance() {
  if (StringSerializer_instance == null)
    new StringSerializer();
  return StringSerializer_instance;
}
function error($this) {
  throw IllegalStateException_init_$Create$('Primitive descriptor ' + $this.oe_1 + ' does not have elements');
}
function PrimitiveSerialDescriptor(serialName, kind) {
  this.oe_1 = serialName;
  this.pe_1 = kind;
}
protoOf(PrimitiveSerialDescriptor).pa = function () {
  return this.oe_1;
};
protoOf(PrimitiveSerialDescriptor).ya = function () {
  return this.pe_1;
};
protoOf(PrimitiveSerialDescriptor).bb = function () {
  return 0;
};
protoOf(PrimitiveSerialDescriptor).db = function (index) {
  error(this);
};
protoOf(PrimitiveSerialDescriptor).eb = function (name) {
  error(this);
};
protoOf(PrimitiveSerialDescriptor).hb = function (index) {
  error(this);
};
protoOf(PrimitiveSerialDescriptor).gb = function (index) {
  error(this);
};
protoOf(PrimitiveSerialDescriptor).fb = function (index) {
  error(this);
};
protoOf(PrimitiveSerialDescriptor).toString = function () {
  return 'PrimitiveDescriptor(' + this.oe_1 + ')';
};
protoOf(PrimitiveSerialDescriptor).equals = function (other) {
  if (this === other)
    return true;
  if (!(other instanceof PrimitiveSerialDescriptor))
    return false;
  if (this.oe_1 === other.oe_1 && equals(this.pe_1, other.pe_1))
    return true;
  return false;
};
protoOf(PrimitiveSerialDescriptor).hashCode = function () {
  return getStringHashCode(this.oe_1) + imul(31, this.pe_1.hashCode()) | 0;
};
function IntSerializer() {
  IntSerializer_instance = this;
  this.qe_1 = new PrimitiveSerialDescriptor('kotlin.Int', INT_getInstance());
}
protoOf(IntSerializer).s9 = function () {
  return this.qe_1;
};
protoOf(IntSerializer).re = function (encoder, value) {
  return encoder.rc(value);
};
protoOf(IntSerializer).t9 = function (encoder, value) {
  return this.re(encoder, (!(value == null) ? typeof value === 'number' : false) ? value : THROW_CCE());
};
protoOf(IntSerializer).u9 = function (decoder) {
  return decoder.ac();
};
var IntSerializer_instance;
function IntSerializer_getInstance() {
  if (IntSerializer_instance == null)
    new IntSerializer();
  return IntSerializer_instance;
}
function DoubleSerializer() {
  DoubleSerializer_instance = this;
  this.se_1 = new PrimitiveSerialDescriptor('kotlin.Double', DOUBLE_getInstance());
}
protoOf(DoubleSerializer).s9 = function () {
  return this.se_1;
};
protoOf(DoubleSerializer).te = function (encoder, value) {
  return encoder.sc(value);
};
protoOf(DoubleSerializer).t9 = function (encoder, value) {
  return this.te(encoder, (!(value == null) ? typeof value === 'number' : false) ? value : THROW_CCE());
};
protoOf(DoubleSerializer).u9 = function (decoder) {
  return decoder.bc();
};
var DoubleSerializer_instance;
function DoubleSerializer_getInstance() {
  if (DoubleSerializer_instance == null)
    new DoubleSerializer();
  return DoubleSerializer_instance;
}
function NamedValueDecoder() {
  TaggedDecoder.call(this);
}
protoOf(NamedValueDecoder).we = function (_this__u8e3s4, index) {
  return this.ye(this.xe(_this__u8e3s4, index));
};
protoOf(NamedValueDecoder).ye = function (nestedName) {
  var tmp0_elvis_lhs = this.bf();
  return this.cf(tmp0_elvis_lhs == null ? '' : tmp0_elvis_lhs, nestedName);
};
protoOf(NamedValueDecoder).xe = function (descriptor, index) {
  return descriptor.db(index);
};
protoOf(NamedValueDecoder).cf = function (parentName, childName) {
  var tmp;
  // Inline function 'kotlin.text.isEmpty' call
  if (charSequenceLength(parentName) === 0) {
    tmp = childName;
  } else {
    tmp = parentName + '.' + childName;
  }
  return tmp;
};
protoOf(NamedValueDecoder).df = function () {
  return this.ze_1.n() ? '$' : joinToString(this.ze_1, '.', '$.');
};
function tagBlock($this, tag, block) {
  $this.if(tag);
  var r = block();
  if (!$this.af_1) {
    $this.jf();
  }
  $this.af_1 = false;
  return r;
}
function TaggedDecoder$decodeSerializableElement$lambda(this$0, $deserializer, $previousValue) {
  return function () {
    return this$0.dc($deserializer, $previousValue);
  };
}
function TaggedDecoder() {
  var tmp = this;
  // Inline function 'kotlin.collections.arrayListOf' call
  tmp.ze_1 = ArrayList_init_$Create$();
  this.af_1 = false;
}
protoOf(TaggedDecoder).mc = function () {
  return EmptySerializersModule_0();
};
protoOf(TaggedDecoder).ef = function (tag) {
  throw SerializationException_init_$Create$_0(toString(getKClassFromExpression(this)) + " can't retrieve untyped values");
};
protoOf(TaggedDecoder).ff = function (tag) {
  var tmp = this.ef(tag);
  return typeof tmp === 'number' ? tmp : THROW_CCE();
};
protoOf(TaggedDecoder).gf = function (tag) {
  var tmp = this.ef(tag);
  return typeof tmp === 'number' ? tmp : THROW_CCE();
};
protoOf(TaggedDecoder).hf = function (tag) {
  var tmp = this.ef(tag);
  return typeof tmp === 'string' ? tmp : THROW_CCE();
};
protoOf(TaggedDecoder).dc = function (deserializer, previousValue) {
  return this.ec(deserializer);
};
protoOf(TaggedDecoder).ac = function () {
  return this.ff(this.jf());
};
protoOf(TaggedDecoder).bc = function () {
  return this.gf(this.jf());
};
protoOf(TaggedDecoder).cc = function () {
  return this.hf(this.jf());
};
protoOf(TaggedDecoder).fc = function (descriptor) {
  return this;
};
protoOf(TaggedDecoder).gc = function (descriptor) {
};
protoOf(TaggedDecoder).hc = function (descriptor, index) {
  return this.ff(this.we(descriptor, index));
};
protoOf(TaggedDecoder).ic = function (descriptor, index) {
  return this.gf(this.we(descriptor, index));
};
protoOf(TaggedDecoder).jc = function (descriptor, index) {
  return this.hf(this.we(descriptor, index));
};
protoOf(TaggedDecoder).kc = function (descriptor, index, deserializer, previousValue) {
  var tmp = this.we(descriptor, index);
  return tagBlock(this, tmp, TaggedDecoder$decodeSerializableElement$lambda(this, deserializer, previousValue));
};
protoOf(TaggedDecoder).bf = function () {
  return lastOrNull(this.ze_1);
};
protoOf(TaggedDecoder).if = function (name) {
  this.ze_1.d(name);
};
protoOf(TaggedDecoder).jf = function () {
  var r = this.ze_1.x1(get_lastIndex_0(this.ze_1));
  this.af_1 = true;
  return r;
};
function get_EmptySerializersModuleLegacyJs() {
  _init_properties_SerializersModule_kt__u78ha3();
  return EmptySerializersModule;
}
var EmptySerializersModule;
function SerializersModule() {
}
protoOf(SerializersModule).va = function (kClass, typeArgumentsSerializers, $super) {
  typeArgumentsSerializers = typeArgumentsSerializers === VOID ? emptyList() : typeArgumentsSerializers;
  return $super === VOID ? this.kf(kClass, typeArgumentsSerializers) : $super.kf.call(this, kClass, typeArgumentsSerializers);
};
function SerialModuleImpl(class2ContextualFactory, polyBase2Serializers, polyBase2DefaultSerializerProvider, polyBase2NamedSerializers, polyBase2DefaultDeserializerProvider, hasInterfaceContextualSerializers) {
  SerializersModule.call(this);
  this.mf_1 = class2ContextualFactory;
  this.nf_1 = polyBase2Serializers;
  this.of_1 = polyBase2DefaultSerializerProvider;
  this.pf_1 = polyBase2NamedSerializers;
  this.qf_1 = polyBase2DefaultDeserializerProvider;
  this.rf_1 = hasInterfaceContextualSerializers;
}
protoOf(SerialModuleImpl).ad = function (baseClass, value) {
  if (!baseClass.h6(value))
    return null;
  var tmp0_safe_receiver = this.nf_1.x(baseClass);
  var tmp = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.x(getKClassFromExpression(value));
  var registered = (!(tmp == null) ? isInterface(tmp, SerializationStrategy) : false) ? tmp : null;
  if (!(registered == null))
    return registered;
  var tmp_0 = this.of_1.x(baseClass);
  var tmp1_safe_receiver = (!(tmp_0 == null) ? typeof tmp_0 === 'function' : false) ? tmp_0 : null;
  return tmp1_safe_receiver == null ? null : tmp1_safe_receiver(value);
};
protoOf(SerialModuleImpl).zc = function (baseClass, serializedClassName) {
  var tmp0_safe_receiver = this.pf_1.x(baseClass);
  var tmp;
  if (tmp0_safe_receiver == null) {
    tmp = null;
  } else {
    // Inline function 'kotlin.collections.get' call
    tmp = (isInterface(tmp0_safe_receiver, KtMap) ? tmp0_safe_receiver : THROW_CCE()).x(serializedClassName);
  }
  var tmp_0 = tmp;
  var registered = (!(tmp_0 == null) ? isInterface(tmp_0, KSerializer) : false) ? tmp_0 : null;
  if (!(registered == null))
    return registered;
  var tmp_1 = this.qf_1.x(baseClass);
  var tmp1_safe_receiver = (!(tmp_1 == null) ? typeof tmp_1 === 'function' : false) ? tmp_1 : null;
  return tmp1_safe_receiver == null ? null : tmp1_safe_receiver(serializedClassName);
};
protoOf(SerialModuleImpl).kf = function (kClass, typeArgumentsSerializers) {
  var tmp0_safe_receiver = this.mf_1.x(kClass);
  var tmp = tmp0_safe_receiver == null ? null : tmp0_safe_receiver.sf(typeArgumentsSerializers);
  return (tmp == null ? true : isInterface(tmp, KSerializer)) ? tmp : null;
};
protoOf(SerialModuleImpl).lf = function (collector) {
  // Inline function 'kotlin.collections.forEach' call
  // Inline function 'kotlin.collections.iterator' call
  var _iterator__ex2g4s = this.mf_1.z().i();
  while (_iterator__ex2g4s.j()) {
    var element = _iterator__ex2g4s.k();
    // Inline function 'kotlin.collections.component1' call
    var kclass = element.u();
    // Inline function 'kotlin.collections.component2' call
    var serial = element.v();
    if (serial instanceof Argless) {
      var tmp = isInterface(kclass, KClass) ? kclass : THROW_CCE();
      var tmp_0 = serial.vf_1;
      collector.wf(tmp, isInterface(tmp_0, KSerializer) ? tmp_0 : THROW_CCE());
    } else {
      if (serial instanceof WithTypeArguments) {
        collector.uf(kclass, serial.tf_1);
      } else {
        noWhenBranchMatchedException();
      }
    }
  }
  // Inline function 'kotlin.collections.forEach' call
  // Inline function 'kotlin.collections.iterator' call
  var _iterator__ex2g4s_0 = this.nf_1.z().i();
  while (_iterator__ex2g4s_0.j()) {
    var element_0 = _iterator__ex2g4s_0.k();
    // Inline function 'kotlin.collections.component1' call
    var baseClass = element_0.u();
    // Inline function 'kotlin.collections.component2' call
    var classMap = element_0.v();
    // Inline function 'kotlin.collections.forEach' call
    // Inline function 'kotlin.collections.iterator' call
    var _iterator__ex2g4s_1 = classMap.z().i();
    while (_iterator__ex2g4s_1.j()) {
      var element_1 = _iterator__ex2g4s_1.k();
      // Inline function 'kotlin.collections.component1' call
      var actualClass = element_1.u();
      // Inline function 'kotlin.collections.component2' call
      var serializer = element_1.v();
      var tmp_1 = isInterface(baseClass, KClass) ? baseClass : THROW_CCE();
      var tmp_2 = isInterface(actualClass, KClass) ? actualClass : THROW_CCE();
      // Inline function 'kotlinx.serialization.internal.cast' call
      var tmp$ret$15 = isInterface(serializer, KSerializer) ? serializer : THROW_CCE();
      collector.xf(tmp_1, tmp_2, tmp$ret$15);
    }
  }
  // Inline function 'kotlin.collections.forEach' call
  // Inline function 'kotlin.collections.iterator' call
  var _iterator__ex2g4s_2 = this.of_1.z().i();
  while (_iterator__ex2g4s_2.j()) {
    var element_2 = _iterator__ex2g4s_2.k();
    // Inline function 'kotlin.collections.component1' call
    var baseClass_0 = element_2.u();
    // Inline function 'kotlin.collections.component2' call
    var provider = element_2.v();
    var tmp_3 = isInterface(baseClass_0, KClass) ? baseClass_0 : THROW_CCE();
    collector.yf(tmp_3, typeof provider === 'function' ? provider : THROW_CCE());
  }
  // Inline function 'kotlin.collections.forEach' call
  // Inline function 'kotlin.collections.iterator' call
  var _iterator__ex2g4s_3 = this.qf_1.z().i();
  while (_iterator__ex2g4s_3.j()) {
    var element_3 = _iterator__ex2g4s_3.k();
    // Inline function 'kotlin.collections.component1' call
    var baseClass_1 = element_3.u();
    // Inline function 'kotlin.collections.component2' call
    var provider_0 = element_3.v();
    var tmp_4 = isInterface(baseClass_1, KClass) ? baseClass_1 : THROW_CCE();
    collector.zf(tmp_4, typeof provider_0 === 'function' ? provider_0 : THROW_CCE());
  }
};
function Argless() {
}
function WithTypeArguments() {
}
function ContextualProvider() {
}
var properties_initialized_SerializersModule_kt_fjigjn;
function _init_properties_SerializersModule_kt__u78ha3() {
  if (!properties_initialized_SerializersModule_kt_fjigjn) {
    properties_initialized_SerializersModule_kt_fjigjn = true;
    EmptySerializersModule = new SerialModuleImpl(emptyMap(), emptyMap(), emptyMap(), emptyMap(), emptyMap(), false);
  }
}
function EmptySerializersModule_0() {
  return get_EmptySerializersModuleLegacyJs();
}
function SerializersModuleCollector$contextual$lambda($serializer) {
  return function (it) {
    return $serializer;
  };
}
function SerializersModuleCollector() {
}
function SerializableWith() {
}
function getChecked(_this__u8e3s4, index) {
  if (!(0 <= index ? index <= (_this__u8e3s4.length - 1 | 0) : false))
    throw IndexOutOfBoundsException_init_$Create$('Index ' + index + ' out of bounds ' + get_indices(_this__u8e3s4).toString());
  return _this__u8e3s4[index];
}
function getChecked_0(_this__u8e3s4, index) {
  if (!(0 <= index ? index <= (_this__u8e3s4.length - 1 | 0) : false))
    throw IndexOutOfBoundsException_init_$Create$('Index ' + index + ' out of bounds ' + get_indices_0(_this__u8e3s4).toString());
  return _this__u8e3s4[index];
}
//region block: post-declaration
protoOf(SerialDescriptorImpl).za = get_isNullable;
protoOf(SerialDescriptorImpl).ab = get_isInline;
protoOf(AbstractDecoder).lc = decodeSerializableElement$default;
protoOf(AbstractDecoder).ec = decodeSerializableValue;
protoOf(AbstractDecoder).nc = decodeSequentially;
protoOf(AbstractEncoder).yc = encodeSerializableValue;
protoOf(PluginGeneratedSerialDescriptor).za = get_isNullable;
protoOf(PluginGeneratedSerialDescriptor).ab = get_isInline;
protoOf(InlinePrimitiveDescriptor$1).le = typeParametersSerializers;
protoOf(PrimitiveSerialDescriptor).za = get_isNullable;
protoOf(PrimitiveSerialDescriptor).ab = get_isInline;
protoOf(PrimitiveSerialDescriptor).cb = get_annotations;
protoOf(TaggedDecoder).lc = decodeSerializableElement$default;
protoOf(TaggedDecoder).ec = decodeSerializableValue;
protoOf(TaggedDecoder).nc = decodeSequentially;
//endregion
//region block: exports
export {
  CONTEXTUAL_getInstance as CONTEXTUAL_getInstance2j6ylx8hc4yv2,
  ENUM_getInstance as ENUM_getInstance3ph4fa6o285vr,
  CLASS_getInstance as CLASS_getInstance25nhr3t715wdo,
  LIST_getInstance as LIST_getInstance2leq5bbahk4rz,
  MAP_getInstance as MAP_getInstance141vh6u7faopd,
  OBJECT_getInstance as OBJECT_getInstance167untwb9admi,
  DoubleSerializer_getInstance as DoubleSerializer_getInstance1wncowm4p8ecy,
  IntSerializer_getInstance as IntSerializer_getInstanceuhm8c1wku08l,
  StringSerializer_getInstance as StringSerializer_getInstance11v9md0a7d9yk,
  SealedClassSerializer_init_$Create$ as SealedClassSerializer_init_$Create$2e46e27g2dau6,
  SerializationException_init_$Init$_0 as SerializationException_init_$Init$16fnhi19wdhkq,
  UnknownFieldException_init_$Create$ as UnknownFieldException_init_$Create$29petggjjaptk,
  serializer as serializer1x79l67jvwntn,
  PolymorphicKind as PolymorphicKindla9gurooefwb,
  PrimitiveKind as PrimitiveKindndgbuh6is7ze,
  SerialDescriptor as SerialDescriptor2pelqekb5ic3a,
  ENUM as ENUMlmq49cvwy4ow,
  getContextualDescriptor as getContextualDescriptor2n1gf3b895yb8,
  AbstractDecoder as AbstractDecoder35guh02ubh2hm,
  AbstractEncoder as AbstractEncoder2gxtu3xmy3f8j,
  CompositeDecoder as CompositeDecoder2tzm7wpwkr0og,
  Decoder as Decoder23nde051s631g,
  Encoder as Encoderqvmrpqtq8hnu,
  AbstractPolymorphicSerializer as AbstractPolymorphicSerializer1ccxwp48nfy58,
  ElementMarker as ElementMarker33ojvsajwmzts,
  typeParametersSerializers as typeParametersSerializers2likxjr48tr7y,
  GeneratedSerializer as GeneratedSerializer1f7t7hssdd2ws,
  InlinePrimitiveDescriptor as InlinePrimitiveDescriptor3i6ccn1a4fw94,
  NamedValueDecoder as NamedValueDecoderzk26ztf92xbq,
  PluginGeneratedSerialDescriptor as PluginGeneratedSerialDescriptorqdzeg5asqhfg,
  jsonCachedSerialNames as jsonCachedSerialNameslxufy2gu43jt,
  missingFieldExceptionWithNewMessage as missingFieldExceptionWithNewMessage2gqddjx5jxge9,
  throwMissingFieldException as throwMissingFieldException2cmke0v3ynf14,
  EmptySerializersModule_0 as EmptySerializersModule991ju6pz9b79,
  contextual as contextual3hpp1gupsu4al,
  SerializersModuleCollector as SerializersModuleCollector3dddz14wd7brg,
  DeserializationStrategy as DeserializationStrategy1z3z5pj9f7zc8,
  MissingFieldException as MissingFieldException24tqif29emcmi,
  SerializableWith as SerializableWithd2dap36updxd,
  SerializationException as SerializationExceptioneqrdve3ts2n9,
  SerializationStrategy as SerializationStrategyh6ouydnm6hci,
  findPolymorphicSerializer_0 as findPolymorphicSerializer1nm87hvemahcj,
  findPolymorphicSerializer as findPolymorphicSerializerk638ixyjovk5,
};
//endregion

//# sourceMappingURL=kotlinx-serialization-kotlinx-serialization-core.mjs.map
