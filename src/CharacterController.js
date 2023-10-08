var CharacterController = /** @class */ (function () {
    /**
     * The avatar/character can be made up of multiple meshes arranged in a hierarchy.
     * As such we will pick the root of the hierarchy as the avatar.
     * The root should be a mesh as otherwise we cannot move it with moveWithCollision() method.
     *
     * Mutiple meshes in the hierarchy may have skeletons (if two or more meshes have skeleton then
     * the skeleton will mostly likely be the same).
     * So we will pick as avatar skeleton, the  skeleton of the first mesh in the hierachy which has
     * a skeleton
     *
     * @param {Mesh} avatar
     * @param {ArcRotateCamera} camera
     * @param {Scene} scene 
     * @param {ActionMap} actionMap/animationGroupMap
     *        maps actions to animations and other data like speed,sound etc
     *        or
     *        for backward compatibility could be AnimationGroup Map
     * @param {boolean} faceForward
     */
    function CharacterController(avatar, camera, scene, actionMap, faceForward) {
        console.log('Constructor: CharacterController');
        this.agMap = actionMap; //set ags for reference in animation overrides

        var _this = this;

        this._avatar = null;
        this._skeleton = null;
        this._gravity = 9.8;
        //slopeLimit in degrees
        this._minSlopeLimit = 30;
        this._maxSlopeLimit = 45;
        //slopeLimit in radians
        this._sl1 = Math.PI * this._minSlopeLimit / 180;
        this._sl2 = Math.PI * this._maxSlopeLimit / 180;
        //The av will step up a stair only if it is closer to the ground than the indicated value.
        this._stepOffset = 0.25;
        //toal amount by which the av has moved up
        this._vMoveTot = 0;
        //position of av when it started moving up
        this._vMovStartPos = BABYLON.Vector3.Zero();
        this._actionMap = new ActionMap();
        this._cameraElastic = true;
        this._cameraTarget = BABYLON.Vector3.Zero();
        // added myself : manual adjust camera
        this._cameraManualControl = true;

        //should we go into first person view when camera is near avatar (radius is lowerradius limit)
        this._noFirstPerson = false;
        /**
         * Use this to make the  character controller suitable for a isometeric/top down games or  fps/third person game.
         * 1 In isometric/top down games the camera direction has no bearing on avatar movement.
         * 0 In fps/third person game rotating the camera around the avatar , rotates the avatar too.
         *
         * cannot switch mode to 0 if no camera avaiable.
         */
        this._mode = 0;
        this._saveMode = 0;
        /**
         * checks if a have left hand , right hand issue.
         * In other words if a mesh is a LHS mesh in RHS system or
         * a RHS mesh in LHS system
         * The X axis will be reversed in such cases.
         * thus Cross product of X and Y should be inverse of Z.
         * BABYLONJS GLB models are RHS and exhibit this behavior
         *
         */
        this._isLHS_RHS = false;
        this._signLHS_RHS = -1;
        this._started = false;
        /**
         * use pauseAnim to stop the charactere controller from playing
         * any animation on the character
         * use this when you want to play your animation instead
         * see also resumeAnim()
         */
        this._stopAnim = false;
        this._prevActData = null;
        this._avStartPos = BABYLON.Vector3.Zero();
        this._grounded = false;
        //distance by which AV would move down if in freefall
        this._freeFallDist = 0;
        //how many minimum contiguos frames should the AV have been in free fall
        //before we assume AV is in big freefall.
        //we will use this to remove animation flicker during move down a slope (fall, move, fall move etc)
        //TODO: base this on slope - large slope large count
        this._fallFrameCountMin = 50;
        this._fallFrameCount = 0;
        this._inFreeFall = false;
        this._wasWalking = false;
        this._wasRunning = false;
        this._soundLoopTime = 700;
        this._sndId = null;
        //verical position of AV when it is about to start a jump
        this._jumpStartPosY = 0;
        //for how long the AV has been in the jump
        this._jumpTime = 0;
        //for how long has the av been falling while moving
        this._movFallTime = 0;
        this._sign = 1;
        this._isTurning = false;
        this._noRot = false;
        //for how long has the av been falling while idle (not moving)
        this._idleFallTime = 0;
        this._groundFrameCount = 0;
        this._groundFrameMax = 10;
        this._savedCameraCollision = true;
        this._inFP = false;
        this._ray = new BABYLON.Ray(BABYLON.Vector3.Zero(), BABYLON.Vector3.One(), 1);
        this._rayDir = BABYLON.Vector3.Zero();
        //camera seems to get stuck into things
        //should move camera away from things by a value of cameraSkin
        this._cameraSkin = 0.5;
        this._pickedMeshes = new Array();
        this._makeInvisible = false;
        this._elasticSteps = 50;
        this._move = false;
        this._ekb = true;
        this._isAG = false;
        // does this character have any animations ?
        // remember we can use meshes without anims as characters too
        this._hasAnims = false;
        this._hasCam = true;
        this._camera = camera;
        //if camera is null assume this would be used to control an NPC
        //we cannot use mode 0 as that is dependent on camera being present. so force mode 1
        if (this._camera == null) {
            this._hasCam = false;
            this.setMode(1);
        }
        this._scene = scene;
        var success = this.setAvatar(avatar, faceForward);
        if (!success) {
            console.error("unable to set avatar");
        }
        var dataType = null;
        if (actionMap != null) {
            dataType = this.setActionMap(actionMap);
        }
        //try to use the existing avatar animations
        //animation ranges
        if (!this._isAG && this._skeleton != null)
            this._checkAnimRanges(this._skeleton);
        //animation groups
        if (this._isAG) {
            //TODO
        }
        if (this._hasCam){
            this._savedCameraCollision = this._camera.checkCollisions;
        }
        this._act = new _Action();
        this._renderer = function () { _this._moveAVandCamera(); };
        this._handleKeyUp = function (e) { _this._onKeyUp(e); };
        this._handleKeyDown = function (e) { _this._onKeyDown(e); };

    };

    CharacterController.prototype.getScene = function () {
        return this._scene;
    };
    CharacterController.prototype.setSlopeLimit = function (minSlopeLimit, maxSlopeLimit) {
        this._minSlopeLimit = minSlopeLimit;
        this._maxSlopeLimit = maxSlopeLimit;
        this._sl1 = Math.PI * this._minSlopeLimit / 180;
        this._sl2 = Math.PI * this._maxSlopeLimit / 180;
    };
    /**
     * The av will step up a stair only if it is closer to the ground than the indicated value.
     * Default value is 0.25 m
     * @param {number} stepOffset
     */
    CharacterController.prototype.setStepOffset = function (stepOffset) {
        this._stepOffset = stepOffset;
    };
    /**
     * @param {number} n 
     */
    CharacterController.prototype.setWalkSpeed = function (n) {
        this._actionMap.walk.speed = n;
    };
    CharacterController.prototype.setRunSpeed = function (n) {
        this._actionMap.run.speed = n;
    };
    CharacterController.prototype.setBackSpeed = function (n) {
        this._actionMap.walkBack.speed = n;
    };
    CharacterController.prototype.setBackFastSpeed = function (n) {
        this._actionMap.walkBackFast.speed = n;
    };
    CharacterController.prototype.setJumpSpeed = function (n) {
        this._actionMap.idleJump.speed = n;
        this._actionMap.runJump.speed = n;
    };
    CharacterController.prototype.setLeftSpeed = function (n) {
        this._actionMap.strafeLeft.speed = n;
    };
    CharacterController.prototype.setLeftFastSpeed = function (n) {
        this._actionMap.strafeLeftFast.speed = n;
    };
    CharacterController.prototype.setRightSpeed = function (n) {
        this._actionMap.strafeRight.speed = n;
    };
    CharacterController.prototype.setRightFastSpeed = function (n) {
        this._actionMap.strafeLeftFast.speed = n;
    };
    // get turnSpeed in degrees per second.
    // store in radians per second
    CharacterController.prototype.setTurnSpeed = function (n) {
        this._actionMap.turnLeft.speed = n * Math.PI / 180;
        this._actionMap.turnRight.speed = n * Math.PI / 180;
    };
    CharacterController.prototype.setTurnFastSpeed = function (n) {
        this._actionMap.turnLeftFast.speed = n * Math.PI / 180;
        this._actionMap.turnRightFast.speed = n * Math.PI / 180;
    };
    CharacterController.prototype.setGravity = function (n) {
        this._gravity = n;
    };
    /**
     * Use this to provide animationGroups to the character controller.
     * Provide the AnimationGroups using a Map
     * In this Map the key would be the character controller animation name and
     * the key value would be the animationGroup.
     * Example:
     * let myWalkAnimationGroup:AnimationGroup = ...;
     * let agMap:{} = {
     *  "walk":myWalkAnimationGroup,
     *  "run" : {"ag":myRunAnimationGroup,"rate":1},
     *  "idle" : {"ag":myIdleAnimationGroup,"loop":true,"rate":1},
     *  ....
     *   ....
     * }
     *
     * @param {Map<string, animationGroups>} agMap 
     * a map of character controller animation name to animationGroup
     */
    CharacterController.prototype.setAnimationGroups = function (agMap) {
        if (this._prevActData != null && this._prevActData.exist)
            this._prevActData.ag.stop();
        this._isAG = true;
        this.setActionMap(agMap);
    };
    /**
     * Use this to provide AnimationRanges to the character controller.
     * Provide the AnimationRanges using a Map
     * In this Map the key would be the character controller animation name and
     * the key value would be the animation range name or an object with animation range data.
     * example:
     * let arMap = {
     *  "walk":"myWalk",
     *  "run" : {"name":"myRun","rate":1},
     *  "idle" : {"name":"myIdle","loop":true,"rate":1},
     *  ....
     * }
     *
     * @param {Map<string, animationGroups>} arMap 
     * a map of character controller animation name to animationRange data
     */
    CharacterController.prototype.setAnimationRanges = function (arMap) {
        this._isAG = false;
        this.setActionMap(arMap);
    };
    /**
     * updates action data in the cc actionMap
     * with action data from the provided/input actionMap
     *
     *
     * return "ar" or "ag" depending on if the data provided
     * was animation range or animation group data respt.
     *
     * TODO should validate provided data.
     * In other words if animation range provided make sure
     * the range exist in the skeleton
     * or if animation group provided make sure the animation group
     * can be played on this avataor
     *
     * @param {ActionMap} inActMap
     * @returns {string}
     */
    CharacterController.prototype.setActionMap = function (inActMap) {
        var agMap = false;
        var inActData;


        var ccActionNames = Object.keys(this._actionMap);
        for (var _i = 0, ccActionNames_1 = ccActionNames; _i < ccActionNames_1.length; _i++) {
            var ccActionName = ccActionNames_1[_i];
            var ccActData = this._actionMap[ccActionName];
            //some keys could map to functions (like reset())
            if (!(ccActData instanceof ActionData))
                continue;
            ccActData.exist = false;
            inActData = inActMap[ccActData.id];
            //in previous version of cc the key value was AnimationGroup rather than ActionData
            //lets accomodate that for backward compatibility
            if (inActData != null) {
                if (inActData instanceof BABYLON.AnimationGroup) {
                    ccActData.ag = inActData;
                    ccActData.name = ccActData.ag.name;
                    ccActData.exist = true;
                    agMap = true;
                    this._hasAnims = true;
                }
                else if (inActData.exist) {
                    this._hasAnims = true;
                    ccActData.exist = true;
                    if (inActData instanceof Object) {
                        if (inActData.ag) {
                            ccActData.ag = inActData.ag;
                            agMap = true;
                        }
                        if (inActData.name) 
                            ccActData.name = inActData.name;
                        if (inActData.loop != null)
                            ccActData.loop = inActData.loop;
                        if (inActData.rate)
                            ccActData.rate = inActData.rate;
                        if (inActData.speed)
                            ccActData.speed = inActData.speed;
                        // if (actDataI.key) 
                        //     actDataO.key = actDataI.key;
                        if (inActData.sound)
                            ccActData.sound = inActData.sound;
                    }
                    else {
                        ccActData.name = inActData;
                    }
                }
            }
        }
        this._checkFastAnims();
        //force to play new anims
        this._prevActData = null;
        if (agMap)
            return "ag";
        else
            return "ar";
    };
    /**
     * @returns {ActionMap}
     */
    CharacterController.prototype.getActionMap = function () {
        var map = new ActionMap();

        var keys = Object.keys(this._actionMap);
        for (var _i = 0, keys_1 = keys; _i < keys_1.length; _i++) {
            var key = keys_1[_i];
            var actDataI = this._actionMap[key];

            if (!(actDataI instanceof ActionData))
                continue;
            if (!actDataI.exist)
                continue;

            var actDataO = map[actDataI.id];
            actDataO.ag = actDataI.ag;
            actDataO.name = actDataI.name;
            actDataO.loop = actDataI.loop;
            actDataO.rate = actDataI.rate;
            actDataO.speed = actDataI.speed;
            actDataO.key = actDataI.key;
            actDataO.sound = actDataI.sound;
            actDataO.exist = actDataI.exist;
        }
        return map;
    };
    /**
     * @returns {CCSettings}
     */
    CharacterController.prototype.getSettings = function () {
        var ccs = new CCSettings();
        ccs.faceForward = this.isFaceForward();
        ccs.topDown = this.getMode() == 1 ? true : false;
        ccs.turningOff = this.isTurningOff();
        ccs.cameraTarget = this._cameraTarget.clone();
        ccs.cameraElastic = this._cameraElastic;
        ccs.elasticSteps = this._elasticSteps;
        ccs.makeInvisble = this._makeInvisible;
        ccs.gravity = this._gravity;
        ccs.keyboard = this._ekb;
        ccs.maxSlopeLimit = this._maxSlopeLimit;
        ccs.minSlopeLimit = this._minSlopeLimit;
        ccs.noFirstPerson = this._noFirstPerson;
        ccs.stepOffset = this._stepOffset;
        ccs.sound = this._stepSound;

        return ccs;
    };
    /**
     * @param {CCSettings} ccs 
     */
    CharacterController.prototype.setSettings = function (ccs) {
        this.setFaceForward(ccs.faceForward);
        this.setMode(ccs.topDown ? 1 : 0);
        this.setTurningOff(ccs.turningOff);
        this.setCameraTarget(ccs.cameraTarget);
        this.setCameraElasticity(ccs.cameraElastic);
        this.setElasticiSteps(ccs.elasticSteps);
        this.makeObstructionInvisible(ccs.makeInvisble);
        this.setGravity(ccs.gravity);
        this.enableKeyBoard(ccs.keyboard);
        this.setSlopeLimit(ccs.minSlopeLimit, ccs.maxSlopeLimit);
        this.setNoFirstPerson(ccs.noFirstPerson);
        this.setStepOffset(ccs.stepOffset);
        this.setSound(ccs.sound);
    };
    /**
     * 
     * @param {ActionData} anim 
     * @param {(string | AnimationGroup)} animName 
     * @param {(number | null)} rate 
     * @param {(boolean | null)} loop 
     * @returns 
     */
    CharacterController.prototype._setAnim = function (anim, animName, rate, loop) {
        //animation range need skeleton
        if (!this._isAG && this._skeleton == null)
            return;
        if (animName != null) {
            if (this._isAG) {
                if (!(animName instanceof BABYLON.AnimationGroup))
                    return;
                anim.ag = animName;
                anim.exist = true;
            }
            else {
                if (this._skeleton.getAnimationRange(anim.name) != null) {
                    anim.name = animName;
                    anim.exist = true;
                }
                else {
                    anim.exist = false;
                    return;
                }
            }
        }
        if (loop != null)
            anim.loop = loop;
        if (rate != null)
            anim.rate = rate;
    };
    /**
     * set how smmothly should we transition from one animation to another
     * @param {number} n 
     */
    CharacterController.prototype.enableBlending = function (n) {
        if (this._isAG) {
            var keys = Object.keys(this._actionMap);
            for (var _i = 0, keys_2 = keys; _i < keys_2.length; _i++) {
                var key = keys_2[_i];
                var act = this._actionMap[key];
                if (!(act instanceof ActionData))
                    continue;
                if (act.exist) {
                    var ar = act.ag;
                    for (var _a = 0, _b = ar.targetedAnimations; _a < _b.length; _a++) {
                        var ta = _b[_a];
                        ta.animation.enableBlending = true;
                        ta.animation.blendingSpeed = n;
                    }
                }
            }
        }
        else {
            if (this._skeleton !== null)
                this._skeleton.enableBlending(n);
        }
    };

    CharacterController.prototype.disableBlending = function () {
        if (this._isAG) {
            var keys = Object.keys(this._actionMap);
            for (var _i = 0, keys_3 = keys; _i < keys_3.length; _i++) {
                var key = keys_3[_i];
                var anim = this._actionMap[key];
                if (!(anim instanceof ActionData))
                    continue;
                if (anim.exist) {
                    var ar = anim.ag;
                    for (var _a = 0, _b = ar.targetedAnimations; _a < _b.length; _a++) {
                        var ta = _b[_a];
                        ta.animation.enableBlending = false;
                    }
                }
            }
        }
    };

    //setters for animations
    /**
     * @param {(string | AnimationGroup)} rangeName 
     * @param {number} rate 
     * @param {boolean} loop 
     */
    CharacterController.prototype.setWalkAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.walk, rangeName, rate, loop);
    };
    CharacterController.prototype.setRunAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.run, rangeName, rate, loop);
    };
    CharacterController.prototype.setWalkBackAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.walkBack, rangeName, rate, loop);
        this._copySlowAnims(this._actionMap.walkBackFast, this._actionMap.walkBack);
    };
    CharacterController.prototype.setWalkBackFastAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.walkBackFast, rangeName, rate, loop);
    };
    CharacterController.prototype.setSlideBackAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.slideBack, rangeName, rate, loop);
    };
    CharacterController.prototype.setIdleAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.idle, rangeName, rate, loop);
    };
    CharacterController.prototype.setTurnRightAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.turnRight, rangeName, rate, loop);
        this._copySlowAnims(this._actionMap.turnRightFast, this._actionMap.turnRight);
    };
    CharacterController.prototype.setTurnRightFastAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.turnRightFast, rangeName, rate, loop);
    };
    CharacterController.prototype.setTurnLeftAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.turnLeft, rangeName, rate, loop);
        this._copySlowAnims(this._actionMap.turnLeftFast, this._actionMap.turnLeft);
    };
    CharacterController.prototype.setTurnLeftFastAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.turnLeftFast, rangeName, rate, loop);
    };
    CharacterController.prototype.setStrafeRightAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.strafeRight, rangeName, rate, loop);
        this._copySlowAnims(this._actionMap.strafeRightFast, this._actionMap.strafeRight);
    };
    CharacterController.prototype.setStrafeRightFastAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.strafeRightFast, rangeName, rate, loop);
    };
    CharacterController.prototype.setStrafeLeftAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.strafeLeft, rangeName, rate, loop);
        this._copySlowAnims(this._actionMap.strafeLeftFast, this._actionMap.strafeLeft);
    };
    CharacterController.prototype.setStrafeLeftFastAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.strafeLeftFast, rangeName, rate, loop);
    };
    CharacterController.prototype.setIdleJumpAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.idleJump, rangeName, rate, loop);
    };
    CharacterController.prototype.setRunJumpAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.runJump, rangeName, rate, loop);
    };
    CharacterController.prototype.setFallAnim = function (rangeName, rate, loop) {
        this._setAnim(this._actionMap.fall, rangeName, rate, loop);
    };
    // setters for sound
    /**
     * @param {sound} sound 
     */
    CharacterController.prototype.setSound = function (sound) {
        if (sound == null)
            return;
        this._stepSound = sound;
        var ccActionNames = Object.keys(this._actionMap);
        sound.loop = false;
        for (var _i = 0, ccActionNames_2 = ccActionNames; _i < ccActionNames_2.length; _i++) {
            var ccActionName = ccActionNames_2[_i];
            var ccActData = this._actionMap[ccActionName];
            //some keys could map to functions (like reset())
            if (!(ccActData instanceof ActionData))
                continue;
            ccActData.sound = sound;
            ccActData.sound.attachToMesh(this._avatar);
        }
        this._actionMap.idle.sound = null;
        this._actionMap.fall.sound = null;
        this._actionMap.slideBack.sound = null;
    };
    // setters for keys
    /* Defaults are
        w and up arrow	walk forward
        Shift + w	run
        CapsLock	locks the Shift key and thus pressing "w" results in run
        s and down Arrow	walk backward
        a and left Arrow	turn left
        d and right Arrow	turn right
        q	strafe left
        e	strafe right
        " "	jump
    */
   /**
    * @param {string} key 
    */
    CharacterController.prototype.setWalkKey = function (key) {
        this._actionMap.walk.key = key.toLowerCase();
    };
    CharacterController.prototype.setWalkBackKey = function (key) {
        this._actionMap.walkBack.key = key.toLowerCase();
    };
    CharacterController.prototype.setTurnLeftKey = function (key) {
        this._actionMap.turnLeft.key = key.toLowerCase();
    };
    CharacterController.prototype.setTurnRightKey = function (key) {
        this._actionMap.turnRight.key = key.toLowerCase();
    };
    CharacterController.prototype.setStrafeLeftKey = function (key) {
        this._actionMap.strafeLeft.key = key.toLowerCase();
    };
    CharacterController.prototype.setStrafeRightKey = function (key) {
        this._actionMap.strafeRight.key = key.toLowerCase();
    };
    CharacterController.prototype.setJumpKey = function (key) {
        this._actionMap.idleJump.key = key.toLowerCase();
    };
    /**
     * @param {boolean} b
     */
    CharacterController.prototype.setCameraElasticity = function (b) {
        this._cameraElastic = b;
    };
    /**
     * @param {number} n
     */
    CharacterController.prototype.setElasticiSteps = function (n) {
        this._elasticSteps = n;
    };
    CharacterController.prototype.makeObstructionInvisible = function (b) {
        this._makeInvisible = b;
    };
    /**
     * @param {BABYLON.Vector3} v
     */
    CharacterController.prototype.setCameraTarget = function (v) {
        this._cameraTarget.copyFrom(v);
    };

    /**
     * user should call this whenever the user changes the camera checkCollision
     * property
     *
     */
    CharacterController.prototype.cameraCollisionChanged = function () {
        this._savedCameraCollision = this._camera.checkCollisions;
    };
    CharacterController.prototype.setNoFirstPerson = function (b) {
        this._noFirstPerson = b;
    };

    /**
     * if av has the required anim (walk, run etc) then
     * mark that anim as existing
     *
     * @param {Skeleton} skel
     */
    CharacterController.prototype._checkAnimRanges = function (skel) {
        var keys = Object.keys(this._actionMap);
        for (var _i = 0, keys_4 = keys; _i < keys_4.length; _i++) {
            var key = keys_4[_i];
            var anim = this._actionMap[key];
            if (!(anim instanceof ActionData))
                continue;
            if (skel != null) {
                if (skel.getAnimationRange(anim.id) != null) {
                    anim.name = anim.id;
                    anim.exist = true;
                    this._hasAnims = true;
                }
            }
            else {
                anim.exist = false;
            }
        }
        this._checkFastAnims();
    };
    /**
     * if fast anims do not exist then use their slow counterpart as them but double the rate at which they play
     */
    CharacterController.prototype._checkFastAnims = function () {
        this._copySlowAnims(this._actionMap.walkBackFast, this._actionMap.walkBack);
        this._copySlowAnims(this._actionMap.turnRightFast, this._actionMap.turnRight);
        this._copySlowAnims(this._actionMap.turnLeftFast, this._actionMap.turnLeft);
        this._copySlowAnims(this._actionMap.strafeRightFast, this._actionMap.strafeRight);
        this._copySlowAnims(this._actionMap.strafeLeftFast, this._actionMap.strafeLeft);
    };
    /**
     *
     * @param {ActionData} f
     * @param {ActionData} s 
     */
    CharacterController.prototype._copySlowAnims = function (f, s) {
        if (f.exist)
            return;
        if (!s.exist)
            return;
        f.exist = true;
        f.ag = s.ag;
        f.name = s.name;
        f.rate = s.rate * 2;
    };

    /**
     * Use this to make the  character controller suitable for a isometeric/top down games or  fps/third person game.
     * 1 In isometric/top down games the camera direction has no bearing on avatar movement.
     * 0 In fps/third person game rotating the camera around the avatar , rotates the avatar too.
     *
     * cannot switch mode to 0 if no camera avaiable.
     * mode 1 is almost useless, just use mode 0 + a detached camera.
     * 
     * @param {number} n
     */
    CharacterController.prototype.setMode = function (n) {
        //cannot switch mode to 0 if no camera avaiable.
        if (this._hasCam) {
            this._mode = n;
            this._saveMode = n;
        }
        else {
            this._mode = 1;
            this._saveMode = 1;
        }
    };
    CharacterController.prototype.getMode = function () {
        return this._mode;
    };
    /**
     * Use this to set  turning off.
     * When turining is off
     * a) turn left or turn right keys result in avatar facing and moving left or right with respect to camera.
     * b) walkback/runback key results in avatar facing back and walking/running towards camera.
     *
     * This setting has no effect when mode is 1.
     *
     * @param {boolean} b
     */
    CharacterController.prototype.setTurningOff = function (b) {
        this._noRot = b;
    };
    CharacterController.prototype.isTurningOff = function () {
        return this._noRot;
    };

    /**
     * checks if a have left hand , right hand issue.
     * In other words if a mesh is a LHS mesh in RHS system or
     * a RHS mesh in LHS system
     * The X axis will be reversed in such cases.
     * thus Cross product of X and Y should be inverse of Z.
     * BABYLONJS GLB models are RHS and exhibit this behavior
     *
     * @param {TransformNode} mesh
     */

    CharacterController.prototype._setRHS = function (mesh) {
        var meshMatrix = mesh.getWorldMatrix();
        var _localX = BABYLON.Vector3.FromArray(meshMatrix.m, 0);
        var _localY = BABYLON.Vector3.FromArray(meshMatrix.m, 4);
        var _localZ = BABYLON.Vector3.FromArray(meshMatrix.m, 8);
        var actualZ = BABYLON.Vector3.Cross(_localX, _localY);
        //same direction or opposite direction of Z
        if (BABYLON.Vector3.Dot(actualZ, _localZ) < 0) {
            this._isLHS_RHS = true;
            this._signLHS_RHS = 1;
        }
        else {
            this._isLHS_RHS = false;
            this._signLHS_RHS = -1;
        }
    };

    /**
     * Use setFaceForward(true|false) to indicate that the avatar's face  points forward (true) or backward (false).
     * The avatar's face  points forward if its face is looking in positive local Z axis direction
     */
    //in mode 0, av2cam is used to align avatar with camera , with camera always facing avatar's back
    //note:camera alpha is measured anti-clockwise , avatar rotation is measured clockwise 
    /**
     * 
     * @param {boolean} b 
     */
    CharacterController.prototype.setFaceForward = function (b) {
        this._ff = b;
        this._rhsSign = this._scene.useRightHandedSystem ? -1 : 1;
        if (!this._hasCam) {
            this._av2cam = 0;
            this._ffSign = 1;
            return;
        }
        if (this._isLHS_RHS) {
            this._av2cam = b ? Math.PI / 2 : 3 * Math.PI / 2;
            this._ffSign = b ? 1 : -1;
        }
        else {
            this._av2cam = b ? 3 * Math.PI / 2 : Math.PI / 2;
            this._ffSign = b ? -1 : 1;
        }
    };
    /**
     * @returns {boolean}
     */
    CharacterController.prototype.isFaceForward = function () {
        return this._ff;
    };

    /**
     * @param {Map<string, animationGroups>} agMap
     */
    CharacterController.prototype.checkAGs = function (agMap) {
        var keys = Object.keys(this._actionMap);
        for (var _i = 0, keys_5 = keys; _i < keys_5.length; _i++) {
            var key = keys_5[_i];
            var anim = this._actionMap[key];
            if (!(anim instanceof ActionData))
                continue;
            if (agMap[anim.name] != null) {
                anim.ag = agMap[anim.name];
                anim.exist = true;
            }
        }
    };

    // check if any of the mesh on the node tree is refrenced by any animation group
    /**
     * @param {Node} node
     * @param {AnimationGroup[]} ags
     * @param {boolean} fromRoot
     * @returns {boolean}
     */
    CharacterController.prototype._containsAG = function (node, ags, fromRoot) {
        var r; // Node
        var ns; // Node[]
        if (fromRoot) {
            r = this._getRoot(node);
            ns = r.getChildren(function (n) { return (n instanceof BABYLON.TransformNode); }, false);
        }
        else {
            r = node;
            ns = [r];
        }
        for (var _i = 0, ags_1 = ags; _i < ags_1.length; _i++) {
            var ag = ags_1[_i];
            var tas = ag.targetedAnimations;
            for (var _a = 0, tas_1 = tas; _a < tas_1.length; _a++) {
                var ta = tas_1[_a];
                if (ns.indexOf(ta.target) > -1) {
                    return true;
                }
            }
        }
        return false;
    };

    /**
     * get the root of Node
     * @param {Node} tn
     * @returns  {Node}
     */
    CharacterController.prototype._getRoot = function (tn) {
        if (tn.parent == null)
            return tn;
        return this._getRoot(tn.parent);
    };
    CharacterController.prototype.start = function () {
        if (this._started)
            return;
        this._started = true;
        this._act.reset();
        this._movFallTime = 0;
        //first time we enter render loop, delta time is zero
        this._idleFallTime = 0.001;
        this._grounded = false;
        this._updateTargetValue();
        if (this._ekb)
            this.enableKeyBoard(true);
        
        this._scene.registerBeforeRender(this._renderer);
    };
    CharacterController.prototype.stop = function () {
        if (!this._started)
            return;
        this._started = false;
        this._scene.unregisterBeforeRender(this._renderer);
        this.enableKeyBoard(false);
        this._prevActData = null;
    };

    /**
     * use pauseAnim to stop the charactere controller from playing
     * any animation on the character
     * use this when you want to play your animation instead
     * see also resumeAnim()
     */
    CharacterController.prototype.pauseAnim = function () {
        this._stopAnim = true;
        if (this._prevActData != null && this._prevActData.exist) {
            //stop current animation
            if (this._isAG) {
                this._prevActData.ag.stop();
            }
            else {
                //this._scene.stopAnimation(this._skeleton, this._prevActData.name);
                this._scene.stopAnimation(this._skeleton);
                //this._scene.stopAllAnimations();
            }
            //stop current sound
            if (this._prevActData.sound != null) {
                this._prevActData.sound.stop();
            }
            clearInterval(this._sndId);

            this._scene.unregisterBeforeRender(this._renderer);
        }
    };
    /**
     * use resumeAnim to resume the character controller playing
     * animations on the character.
     * see also pauseAnim()
     */
    CharacterController.prototype.resumeAnim = function () {
        this._stopAnim = false;
        this._prevActData = null;
        this._scene.registerBeforeRender(this._renderer);
    };
    //used only in mode 1
    //value 1 or -1 , -1 if avatar is facing camera
    //this._notFacingCamera = 1;
    /**
     * @returns {number}
     */
    CharacterController.prototype._isAvFacingCamera = function () {
        if (!this._hasCam)
            return 1;
        if (this._mode == 0)
            return -1;
        if (BABYLON.Vector3.Dot(this._avatar.forward, this._avatar.position.subtract(this._camera.position)) < 0)
            return 1;
        else
            return -1;
    };
    CharacterController.prototype._moveAVandCamera = function () {
        this._avStartPos.copyFrom(this._avatar.position);
        var actData = null;
        var dt = this._scene.getEngine().getDeltaTime() / 1000;
        if (this._act._jump && !this._inFreeFall) {
            this._grounded = false;
            this._idleFallTime = 0;
            actData = this._doJump(dt);
        }
        else if (this.anyMovement() || this._inFreeFall) {
            this._grounded = false;
            this._idleFallTime = 0;
            actData = this._doMove(dt);
        }
        else if (!this._inFreeFall) {
            actData = this._doIdle(dt);
        }
        if (!this._stopAnim && this._hasAnims && actData != null) {
            if (this._prevActData !== actData) {
                if (actData.exist) {
                    //animation frame counts
                    var c = void 0; // number
                    var fps = 30; // number
                    if (this._isAG) {
                        if (this._prevActData != null && this._prevActData.exist)
                            this._prevActData.ag.stop();
                        actData.ag.start(actData.loop, actData.rate);
                        fps = actData.ag.targetedAnimations[0].animation.framePerSecond;
                        c = (actData.ag.to - actData.ag.from);
                    }
                    else {
                        var a = this._skeleton.beginAnimation(actData.name, actData.loop, actData.rate);
                        fps = a.getAnimations()[0].animation.framePerSecond;
                        c = this._skeleton.getAnimationRange(actData.name).to - this._skeleton.getAnimationRange(actData.name).from;
                    }
                    //SOUND
                    //TODO do sound as animationevent.
                    if (this._prevActData != null && this._prevActData.sound != null) {
                        this._prevActData.sound.stop();
                    }
                    clearInterval(this._sndId);
                    if (actData.sound != null) {
                        actData.sound.play();
                        //play sound twice during the animation
                        this._sndId = setInterval(function () { 
                            actData.sound.play();
                        }, c * 1000 / (fps * Math.abs(actData.rate) * 2));
                    }
                }
                this._prevActData = actData;
            }
        }
        this._updateTargetValue();
        return;
    };

    /**
     * @param {number} dt 
     * @returns {ActionData}
     */
    CharacterController.prototype._doJump = function (dt) {
        var actData = null;
        actData = this._actionMap.runJump;
        if (this._jumpTime === 0) {
            this._jumpStartPosY = this._avatar.position.y;
        }
        this._jumpTime = this._jumpTime + dt;
        var forwardDist = 0;
        var jumpDist = 0;
        var disp; // BABYLON.Vector3
        if (this._hasCam && this._mode != 1 && !this._noRot)
            this._avatar.rotation.y = this._av2cam - this._camera.alpha;
        if (this._wasRunning || this._wasWalking) {
            if (this._wasRunning) {
                forwardDist = this._actionMap.run.speed * dt;
            }
            else if (this._wasWalking) {
                forwardDist = this._actionMap.walk.speed * dt;
            }
            //find out in which horizontal direction the AV was moving when it started the jump
            disp = this._moveVector.clone();
            disp.y = 0;
            disp = disp.normalize();
            disp.scaleToRef(forwardDist, disp);
            jumpDist = this._calcJumpDist(this._actionMap.runJump.speed, dt);
            disp.y = jumpDist;
        }
        else {
            jumpDist = this._calcJumpDist(this._actionMap.idleJump.speed, dt);
            disp = new BABYLON.Vector3(0, jumpDist, 0);
            actData = this._actionMap.idleJump;
            //this.avatar.ellipsoid.y=this._ellipsoid.y/2;
        }
        //moveWithCollision only seems to happen if length of displacment is atleast 0.001
        this._avatar.moveWithCollisions(disp);
        if (jumpDist < 0) {
            //this.avatar.ellipsoid.y=this._ellipsoid.y;
            //check if going up a slope or back on flat ground 
            if ((this._avatar.position.y > this._avStartPos.y) || ((this._avatar.position.y === this._avStartPos.y) && (disp.length() > 0.001))) {
                this._endJump();
            }
            else if (this._avatar.position.y < this._jumpStartPosY) {
                //the avatar is below the point from where it started the jump
                //so it is either in free fall or is sliding along a downward slope
                //
                //if the actual displacemnt is same as the desired displacement then AV is in freefall
                //else it is on a slope
                const actDisp = this._avatar.position.subtract(this._avStartPos); // BABYLON.Vector3
                if (!(this._areVectorsEqual(actDisp, disp, 0.001))) {
                    //AV is on slope
                    //Should AV continue to slide or stop?
                    //if slope is less steeper than acceptable then stop else slide
                    if (this._verticalSlope(actDisp) <= this._sl1) {
                        this._endJump();
                    }
                }
                else {
                    actData = this._actionMap.fall;
                }
            }
        }
        return actData;
    };
    /**
     * @param {number} speed 
     * @param {number} dt 
     * @returns {number}
     */
    CharacterController.prototype._calcJumpDist = function (speed, dt) {
        //up velocity at the begining of the lastt frame (v=u+at)
        var js = speed - this._gravity * this._jumpTime;
        //distance travelled up since last frame to this frame (s=ut+1/2*at^2)
        var jumpDist = js * dt - 0.5 * this._gravity * dt * dt;
        return jumpDist;
    };
    /**
     * does cleanup at the end of a jump
     */
    CharacterController.prototype._endJump = function () {
        this._act._jump = false;
        this._jumpTime = 0;
        this._wasWalking = false;
        this._wasRunning = false;
    };
    /**
     * checks if two vectors v1 and v2 are equal within a precision of p
     * @param {BABYLON.Vector3} v1
     * @param {BABYLON.Vector3} v2
     * @param {number} P
     * @returns {boolean}
     */
    CharacterController.prototype._areVectorsEqual = function (v1, v2, p) {
        return ((Math.abs(v1.x - v2.x) < p) && (Math.abs(v1.y - v2.y) < p) && (Math.abs(v1.z - v2.z) < p));
    };
    /** 
     * returns the slope (in radians) of a vector in the vertical plane
     * @param {BABYLON.Vector3} v
     * @returns {number}
     */
    CharacterController.prototype._verticalSlope = function (v) {
        return Math.atan(Math.abs(v.y / Math.sqrt(v.x * v.x + v.z * v.z)));
    };

    /**
     * @param {number} dt 
     * @returns {ActionData}
     */
    CharacterController.prototype._doMove = function (dt) {

        //initial down velocity
        var u = this._movFallTime * this._gravity;
        //calculate the distance by which av should fall down since last frame
        //assuming it is in freefall
        this._freeFallDist = u * dt + this._gravity * dt * dt / 2;

        this._movFallTime = this._movFallTime + dt;

        var moving = false;
        var actdata = null; // ActionData

        if (this._inFreeFall) {
            this._moveVector.y = -this._freeFallDist;
            moving = true;
        }


        //rotate avatar with respect to camera direction. 
        this._rotateAV2C();

        //rotate the avatar in case player is trying to rotate the avatar. rotate the camera too if camera turning is on
        actdata = this._rotateAVnC(actdata, moving, dt);

        //now that avatar is rotated properly, construct the vector to move the avatar 
        //donot move the avatar if avatar is in freefall

        if (!this._inFreeFall) {
            this._wasWalking = false;
            this._wasRunning = false;

            var sign = void 0; // number
            var horizDist = 0;
            switch (true) {
                case (this._act._stepLeft):
                    sign = this._signLHS_RHS * this._isAvFacingCamera();
                    horizDist = this._actionMap.strafeLeft.speed * dt;
                    if (this._act._speedMod) {
                        horizDist = this._actionMap.strafeLeftFast.speed * dt;
                        actdata = (-this._ffSign * sign > 0) ? this._actionMap.strafeLeftFast : this._actionMap.strafeRightFast;
                    }
                    else {
                        actdata = (-this._ffSign * sign > 0) ? this._actionMap.strafeLeft : this._actionMap.strafeRight;
                    }
                    this._moveVector = this._avatar.calcMovePOV(sign * horizDist, -this._freeFallDist, 0);
                    moving = true;
                    break;
                case (this._act._stepRight):
                    sign = -this._signLHS_RHS * this._isAvFacingCamera();
                    horizDist = this._actionMap.strafeRight.speed * dt;
                    if (this._act._speedMod) {
                        horizDist = this._actionMap.strafeRightFast.speed * dt;
                        actdata = (-this._ffSign * sign > 0) ? this._actionMap.strafeLeftFast : this._actionMap.strafeRightFast;
                    }
                    else {
                        actdata = (-this._ffSign * sign > 0) ? this._actionMap.strafeLeft : this._actionMap.strafeRight;
                    }
                    this._moveVector = this._avatar.calcMovePOV(sign * horizDist, -this._freeFallDist, 0);
                    moving = true;
                    break;
                case (this._act._walk || (this._noRot && this._mode == 0)):
                    if (this._act._speedMod) {
                        this._wasRunning = true;
                        horizDist = this._actionMap.run.speed * dt;
                        actdata = this._actionMap.run;
                    }
                    else {
                        this._wasWalking = true;
                        horizDist = this._actionMap.walk.speed * dt;
                        actdata = this._actionMap.walk;
                    }
                    this._moveVector = this._avatar.calcMovePOV(0, -this._freeFallDist, this._ffSign * horizDist);
                    moving = true;
                    break;
                case (this._act._walkback):
                    horizDist = this._actionMap.walkBack.speed * dt;
                    if (this._act._speedMod) {
                        horizDist = this._actionMap.walkBackFast.speed * dt;
                        actdata = this._actionMap.walkBackFast;
                    }
                    else {
                        actdata = this._actionMap.walkBack;
                    }
                    this._moveVector = this._avatar.calcMovePOV(0, -this._freeFallDist, -this._ffSign * horizDist);
                    moving = true;
                    break;
            }
        }

        // move the avatar

        if (moving) {
            if (this._moveVector.length() > 0.001) {
                this._avatar.moveWithCollisions(this._moveVector);
                //walking up a slope
                if (this._avatar.position.y > this._avStartPos.y) {
                    var actDisp = this._avatar.position.subtract(this._avStartPos);
                    var _slp = this._verticalSlope(actDisp);
                    if (_slp >= this._sl2) {
                        //this._climbingSteps=true;
                        //is av trying to go up steps
                        if (this._stepOffset > 0) {
                            if (this._vMoveTot == 0) {
                                //if just started climbing note down the position
                                this._vMovStartPos.copyFrom(this._avStartPos);
                            }
                            this._vMoveTot = this._vMoveTot + (this._avatar.position.y - this._avStartPos.y);
                            if (this._vMoveTot > this._stepOffset) {
                                //move av back to its position at begining of steps
                                this._vMoveTot = 0;
                                this._avatar.position.copyFrom(this._vMovStartPos);
                                this._endFreeFall();
                            }
                        }
                        else {
                            //move av back to old position
                            this._avatar.position.copyFrom(this._avStartPos);
                            this._endFreeFall();
                        }
                    }
                    else {
                        this._vMoveTot = 0;
                        if (_slp > this._sl1) {
                            //av is on a steep slope , continue increasing the moveFallTIme to deaccelerate it
                            this._fallFrameCount = 0;
                            this._inFreeFall = false;
                        }
                        else {
                            //continue walking
                            this._endFreeFall();
                        }
                    }
                }
                else if ((this._avatar.position.y) < this._avStartPos.y) {
                    const actDisp = this._avatar.position.subtract(this._avStartPos);
                    if (!(this._areVectorsEqual(actDisp, this._moveVector, 0.001))) {
                        //AV is on slope
                        //Should AV continue to slide or walk?
                        //if slope is less steeper than acceptable then walk else slide
                        if (this._verticalSlope(actDisp) <= this._sl1) {
                            this._endFreeFall();
                        }
                        else {
                            //av is on a steep slope , continue increasing the moveFallTIme to deaccelerate it
                            this._fallFrameCount = 0;
                            this._inFreeFall = false;
                        }
                    }
                    else {
                        this._inFreeFall = true;
                        this._fallFrameCount++;
                        //AV could be running down a slope which mean freefall,run,frefall run ...
                        //to remove anim flicker, check if AV has been falling down continously for last few consecutive frames
                        //before changing to free fall animation
                        if (this._fallFrameCount > this._fallFrameCountMin) {
                            actdata = this._actionMap.fall;
                        }
                    }
                }
                else {
                    this._endFreeFall();
                }
            }
        }
        return actdata;
    };
    /**
     * rotate avatar with respect to camera direction.
     */
    CharacterController.prototype._rotateAV2C = function () {
        if (this._hasCam)
            if (this._mode != 1) {
                var ca = (this._hasCam) ? (this._av2cam - this._camera.alpha) : 0;
                if (this._noRot) {
                    switch (true) {
                        case (this._act._walk && this._act._turnRight):
                            this._avatar.rotation.y = ca + this._rhsSign * Math.PI / 4;
                            break;
                        case (this._act._walk && this._act._turnLeft):
                            this._avatar.rotation.y = ca - this._rhsSign * Math.PI / 4;
                            break;
                        case (this._act._walkback && this._act._turnRight):
                            this._avatar.rotation.y = ca + this._rhsSign * 3 * Math.PI / 4;
                            break;
                        case (this._act._walkback && this._act._turnLeft):
                            this._avatar.rotation.y = ca - this._rhsSign * 3 * Math.PI / 4;
                            break;
                        case (this._act._walk):
                            this._avatar.rotation.y = ca;
                            break;
                        case (this._act._walkback):
                            this._avatar.rotation.y = ca + Math.PI;
                            break;
                        case (this._act._turnRight):
                            this._avatar.rotation.y = ca + this._rhsSign * Math.PI / 2;
                            break;
                        case (this._act._turnLeft):
                            this._avatar.rotation.y = ca - this._rhsSign * Math.PI / 2;
                            break;
                    }
                }
                else {
                    if (this._hasCam)
                        this._avatar.rotation.y = ca;
                }
            }
    };
    /**
     * rotate the avatar in case player is trying to rotate the avatar. rotate the camera too if camera turning is on
     * @param {ActionData} anim 
     * @param {boolean} moving 
     * @param {number} dt 
     * @returns {ActionData}
     */
    CharacterController.prototype._rotateAVnC = function (anim, moving, dt) {
        if (!(this._noRot && this._mode == 0) && (!this._act._stepLeft && !this._act._stepRight) && (this._act._turnLeft || this._act._turnRight)) {
            var turnAngle = this._actionMap.turnLeft.speed * dt;
            if (this._act._speedMod) {
                turnAngle = 2 * turnAngle;
            }
            var a = void 0;
            if (this._mode == 1) {
                // while turining, the avatar could start facing away from camera and end up facing camera.
                // we should not switch turning direction during this transition
                if (!this._isTurning) {
                    // if (this._act.name != this._act.prevName) {
                    // this._act.prevName = this._act.name;
                    this._sign = -this._ffSign * this._isAvFacingCamera();
                    if (this._isLHS_RHS)
                        this._sign = -this._sign;
                    this._isTurning = true;
                }
                a = this._sign;
                if (this._act._turnLeft) {
                    if (this._act._walk) { }
                    else if (this._act._walkback)
                        a = -this._sign;
                    else {
                        anim = (this._sign > 0) ? this._actionMap.turnRight : this._actionMap.turnLeft;
                    }
                }
                else {
                    if (this._act._walk)
                        a = -this._sign;
                    else if (this._act._walkback) { }
                    else {
                        a = -this._sign;
                        anim = (this._sign > 0) ? this._actionMap.turnLeft : this._actionMap.turnRight;
                    }
                }
            }
            else {
                a = 1;
                if (this._act._turnLeft) {
                    if (this._act._walkback)
                        a = -1;
                    if (!moving)
                        anim = this._actionMap.turnLeft;
                }
                else {
                    if (this._act._walk)
                        a = -1;
                    if (!moving) {
                        a = -1;
                        anim = this._actionMap.turnRight;
                    }
                    if (this._act._walkback)
                        a = 1;
                }
                if (this._hasCam)
                    this._camera.alpha = this._camera.alpha + this._rhsSign * turnAngle * a;
            }
            this._avatar.rotation.y = this._avatar.rotation.y + turnAngle * a;
        }
        return anim;
    };
    CharacterController.prototype._endFreeFall = function () {
        this._movFallTime = 0;
        this._fallFrameCount = 0;
        this._inFreeFall = false;
    };
    /**
     * for how long has the av been falling while idle (not moving)
     * @param {number} dt 
     * @returns {ActionData}
     */
    CharacterController.prototype._doIdle = function (dt) {
        if (this._grounded) {
            return this._actionMap.idle;
        }
        this._wasWalking = false;
        this._wasRunning = false;
        this._movFallTime = 0;
        var anim = this._actionMap.idle;
        this._fallFrameCount = 0;
        if (dt === 0) {
            this._freeFallDist = 5;
        }
        else {
            const u = this._idleFallTime * this._gravity;
            this._freeFallDist = u * dt + this._gravity * dt * dt / 2;
            this._idleFallTime = this._idleFallTime + dt;
        }
        //if displacement is less than 0.01(? need to verify further) then 
        //moveWithDisplacement down against a surface seems to push the AV up by a small amount!!
        if (this._freeFallDist < 0.01)
            return anim;
        const disp = new BABYLON.Vector3(0, -this._freeFallDist, 0);
        if (this._hasCam && this._mode != 1 && !this._noRot)
            this._avatar.rotation.y = this._av2cam - this._camera.alpha;
        this._avatar.moveWithCollisions(disp);
        if ((this._avatar.position.y > this._avStartPos.y) || (this._avatar.position.y === this._avStartPos.y)) {
            //                this.grounded = true;
            //                this.idleFallTime = 0;
            this._groundIt();
        }
        else if (this._avatar.position.y < this._avStartPos.y) {
            //AV is going down. 
            //AV is either in free fall or is sliding along a downward slope
            //
            //if the actual displacemnt is same as the desired displacement then AV is in freefall
            //else it is on a slope
            var actDisp = this._avatar.position.subtract(this._avStartPos);
            if (!(this._areVectorsEqual(actDisp, disp, 0.001))) {
                //AV is on slope
                //Should AV continue to slide or stop?
                //if slope is less steeper than accebtable then stop else slide
                if (this._verticalSlope(actDisp) <= this._sl1) {
                    //                        this.grounded = true;
                    //                        this.idleFallTime = 0;
                    this._groundIt();
                    this._avatar.position.copyFrom(this._avStartPos);
                }
                else {
                    this._unGroundIt();
                    anim = this._actionMap.slideBack;
                }
            }
        }
        //this.pubAnimData(anim, 'doIdle');
        return anim;
    };
    /**
     * donot ground immediately
     * wait few more frames
     */
    CharacterController.prototype._groundIt = function () {
        this._groundFrameCount++;
        if (this._groundFrameCount > this._groundFrameMax) {
            this._grounded = true;
            this._idleFallTime = 0;
        }
    };
    CharacterController.prototype._unGroundIt = function () {
        this._grounded = false;
        this._groundFrameCount = 0;
    };

    CharacterController.prototype._updateTargetValue = function () {
        if (!this._hasCam)
            return;
        //donot move camera if av is trying to clinb steps
        if (this._vMoveTot == 0)
            this._avatar.position.addToRef(this._cameraTarget, this._camera.target);
        if (this._camera.radius > this._camera.lowerRadiusLimit) {
            if (this._cameraElastic || this._makeInvisible)
                this._handleObstruction();
        }
        if (this._camera.radius <= this._camera.lowerRadiusLimit) {
            if (!this._noFirstPerson && !this._inFP) {
                this._avatar.visibility = 0;
                this._camera.checkCollisions = false;
                this._saveMode = this._mode;
                this._mode = 0;
                this._inFP = true;
            }
        }
        else {
            this._inFP = false;
            this._mode = this._saveMode;
            this._avatar.visibility = 1;
            this._camera.checkCollisions = this._savedCameraCollision;
        }
    };
    
    /**
     * The following method handles the use case wherein some mesh
     * comes between the avatar and the camera thus obstructing the view
     * of the avatar.
     * Two ways this can be handled
     * a) make the obstructing  mesh invisible
     *   instead of invisible a better option would have been to make semi transparent.
     *   Unfortunately, unlike mesh, mesh instances do not "visibility" setting)
     *   Every alternate frame make mesh visible and invisible to give the impression of semi-transparent.
     * b) move the camera in front of the obstructing mesh
     */
    CharacterController.prototype._handleObstruction = function () {
        var _this = this;
        //get vector from av (camera.target) to camera
        this._camera.position.subtractToRef(this._camera.target, this._rayDir);
        //start ray from av to camera
        this._ray.origin = this._camera.target;
        this._ray.length = this._rayDir.length();
        this._ray.direction = this._rayDir.normalize();
        //TODO 
        //handle case were pick is with a child of avatar, avatar atatchment. etc
        // PickingInfo
        var pis = this._scene.multiPickWithRay(this._ray, function (mesh) {
            if (mesh == _this._avatar)
                return false;
            else
                return true;
        });
        if (this._makeInvisible) {
            this._prevPickedMeshes = this._pickedMeshes;
            if (pis.length > 0) {
                this._pickedMeshes = new Array();
                for (var _i = 0, pis_1 = pis; _i < pis_1.length; _i++) {
                    var pi = pis_1[_i];
                    if (pi.pickedMesh.isVisible || this._prevPickedMeshes.includes(pi.pickedMesh)) {
                        pi.pickedMesh.isVisible = false;
                        this._pickedMeshes.push(pi.pickedMesh);
                    }
                }
                for (var _a = 0, _b = this._prevPickedMeshes; _a < _b.length; _a++) {
                    var pm = _b[_a];
                    if (!this._pickedMeshes.includes(pm)) {
                        pm.isVisible = true;
                    }
                }
            }
            else {
                for (var _c = 0, _d = this._prevPickedMeshes; _c < _d.length; _c++) {
                    var pm = _d[_c];
                    pm.isVisible = true;
                }
                this._prevPickedMeshes.length = 0;
            }
        }
        if (this._cameraElastic) {
            if (pis.length > 0) {
                // postion the camera in front of the mesh that is obstructing camera
                //if only one obstruction and it is invisible then if it is not collidable or our camera is not collidable then do nothing
                if ((pis.length == 1 && !this._isSeeAble(pis[0].pickedMesh)) && (!pis[0].pickedMesh.checkCollisions || !this._camera.checkCollisions))
                    return;
                //if our camera is collidable then we donot want it to get stuck behind another collidable obsrtucting mesh
                var pp = null; // BABYLON.Vector3
                //we will asume the order of picked meshes is from closest to avatar to furthest
                //we should get the first one which is visible or invisible and collidable
                for (var i = 0; i < pis.length; i++) {
                    var pm = pis[i].pickedMesh;
                    if (this._isSeeAble(pm)) {
                        pp = pis[i].pickedPoint;
                        break;
                    }
                    else if (pm.checkCollisions) {
                        pp = pis[i].pickedPoint;
                        break;
                    }
                }
                if (pp == null)
                    return;
                var c2p = this._camera.position.subtract(pp); // BABYLON.Vector3
                //note that when camera is collidable, changing the orbital camera radius may not work.
                //changing the radius moves the camera forward (with collision?) and collision can interfere with movement
                //
                //in every cylce we are dividing the distance to tarvel by same number of steps.
                //as we get closer to destination the speed will thus slow down.
                //when just 1 unit distance left, lets snap to the final position.
                //when calculating final position make sure the camera does not get stuck at the pickposition especially
                //if collision is on
                var l = c2p.length();
                if (this._camera.checkCollisions) {
                    var step = void 0; // BABYLON.Vector3
                    if (l <= 1) {
                        step = c2p.addInPlace(c2p.normalizeToNew().scaleInPlace(this._cameraSkin));
                    }
                    else {
                        step = c2p.normalize().scaleInPlace(l / this._elasticSteps);
                    }
                    this._camera.position = this._camera.position.subtract(step);
                }
                else {
                    var step = void 0; // number
                    if (l <= 1)
                        step = l + this._cameraSkin;
                    else
                        step = l / this._elasticSteps;
                    this._camera.radius = this._camera.radius - (step);
                }
            }
        }
    };

    CharacterController.prototype.enableCameraControl = function() {
        if (this._cameraManualControl == false) {
            this._cameraManualControl = true;
            for (const i in this._camera.inputs.attached) {
                const input = this._camera.inputs.attached[i];
                this._camera.inputs.attachInput(input);
            }
        }
    };

    CharacterController.prototype.disableCameraControl = function() {
        if (this._cameraManualControl == true) {
            this._cameraManualControl = false;
            for (const i in this._camera.inputs.attached) {
                console.log(i);
                const input = this._camera.inputs.attached[i];
                input.detachControl();
            }
        }
    };

    /**
     * how many ways can a mesh be invisible?
     * @param {AbstractMesh} mesh 
     * @returns {boolean}
     */
    CharacterController.prototype._isSeeAble = function (mesh) {
        if (!mesh.isVisible)
            return false;
        if (mesh.visibility == 0)
            return false;
        if (mesh.material != null && mesh.material.alphaMode != 0 && mesh.material.alpha == 0)
            return false;
        return true;
        //what about vertex color? groan!
    };
    CharacterController.prototype.anyMovement = function () {
        return (this._act._walk || this._act._walkback || this._act._turnLeft || this._act._turnRight || this._act._stepLeft || this._act._stepRight);
    };
    CharacterController.prototype._onKeyDown = function (e) {
        // let isSwing = false;
        if (!e.key)
            return;
        if (e.repeat)
            return;
        switch (e.key.toLowerCase()) {
            /*
            case this._actionMap.swingRight.key:
                this._act._swingRight = true;
                this.doSwingRight();
                isSwing = true;
                break;
            */
            case this._actionMap.idleJump.key:
                this._act._jump = true;
                break;
            case "capslock":
                this._act._speedMod = !this._act._speedMod;
                break;
            case "shift":
                this._act._speedMod = true;
                break;
            case "up":
            case "arrowup":
            case this._actionMap.walk.key:
                this._act._walk = true;
                break;
            case "left":
            case "arrowleft":
            case this._actionMap.turnLeft.key:
                this._act._turnLeft = true;
                break;
            case "right":
            case "arrowright":
            case this._actionMap.turnRight.key:
                this._act._turnRight = true;
                break;
            case "down":
            case "arrowdown":
            case this._actionMap.walkBack.key:
                this._act._walkback = true;
                break;
            case this._actionMap.strafeLeft.key:
                this._act._stepLeft = true;
                break;
            case this._actionMap.strafeRight.key:
                this._act._stepRight = true;
                break;
        }
        /*
        if (!isSwing) 
            this.stopSwing();
        */
        this._move = this.anyMovement();
    };
    /**
     * @param {KeyboardEvent} e 
     */
    CharacterController.prototype._onKeyUp = function (e) {
        if (!e.key)
            return;
        switch (e.key.toLowerCase()) {
            case "shift":
                this._act._speedMod = false;
                break;
            case "up":
            case "arrowup":
            case this._actionMap.walk.key:
                this._act._walk = false;
                break;
            case "left":
            case "arrowleft":
            case this._actionMap.turnLeft.key:
                this._act._turnLeft = false;
                this._isTurning = false;
                break;
            case "right":
            case "arrowright":
            case this._actionMap.turnRight.key:
                this._act._turnRight = false;
                this._isTurning = false;
                break;
            case "down":
            case "arrowdown":
            case this._actionMap.walkBack.key:
                this._act._walkback = false;
                break;
            case this._actionMap.strafeLeft.key:
                this._act._stepLeft = false;
                break;
            case this._actionMap.strafeRight.key:
                this._act._stepRight = false;
                break;
        }
        this._move = this.anyMovement();
    };
    CharacterController.prototype.isKeyBoardEnabled = function () {
        return this._ekb;
    };
    CharacterController.prototype.enableKeyBoard = function (b) {
        this._ekb = b;
        var canvas = this._scene.getEngine().getRenderingCanvas(); // HTMLCanvasElement
        if (b) {
            canvas.addEventListener("keyup", this._handleKeyUp, false);
            canvas.addEventListener("keydown", this._handleKeyDown, false);
        }
        else {
            canvas.removeEventListener("keyup", this._handleKeyUp, false);
            canvas.removeEventListener("keydown", this._handleKeyDown, false);
        }
    };
    // control movement by commands rather than keyboard.
    CharacterController.prototype.walk = function (b) {
        this._act._walk = b;
    };
    CharacterController.prototype.walkBack = function (b) {
        this._act._walkback = b;
    };
    CharacterController.prototype.walkBackFast = function (b) {
        this._act._walkback = b;
        this._act._speedMod = b;
    };
    CharacterController.prototype.run = function (b) {
        this._act._walk = b;
        this._act._speedMod = b;
    };
    CharacterController.prototype.turnLeft = function (b) {
        this._act._turnLeft = b;
        if (!b)
            this._isTurning = b;
    };
    CharacterController.prototype.turnLeftFast = function (b) {
        this._act._turnLeft = b;
        if (!b)
            this._isTurning = b;
        this._act._speedMod = b;
    };
    CharacterController.prototype.turnRight = function (b) {
        this._act._turnRight = b;
        if (!b)
            this._isTurning = b;
    };
    CharacterController.prototype.turnRightFast = function (b) {
        this._act._turnRight = b;
        if (!b)
            this._isTurning = b;
        this._act._speedMod = b;
    };
    CharacterController.prototype.strafeLeft = function (b) {
        this._act._stepLeft = b;
    };
    CharacterController.prototype.strafeLeftFast = function (b) {
        this._act._stepLeft = b;
        this._act._speedMod = b;
    };
    CharacterController.prototype.strafeRight = function (b) {
        this._act._stepRight = b;
    };
    CharacterController.prototype.strafeRightFast = function (b) {
        this._act._stepRight = b;
        this._act._speedMod = b;
    };
    CharacterController.prototype.jump = function () {
        this._act._jump = true;
    };
    /*
    CharacterController.prototype.idleJump = function () {
        this._act._jump = true;
    };
    CharacterController.prototype.runJump = function () {
        this._act._jump = true;
    };
    CharacterController.prototype.falling = function () {
        this._act._falling = true;
    };
    
    CharacterController.prototype.death = function () {
        this._act._death = true;
    };
    
    CharacterController.prototype.fall = function () {
        this._act._fall = true;
    };
    CharacterController.prototype.point = function () {
        this._act._point = true;
        this.doPoint(); //doesn't really belong here - not sure how else to act on the dataset
    };
    CharacterController.prototype.slideBack = function () {
        this._act._slideBack = true;
    };
    CharacterController.prototype.swingRight = function () {
        this._act._swingRight = true;
    };
    */
    CharacterController.prototype.idle = function () {
        this._act.reset();
    };


    CharacterController.prototype.isAg = function () {
        return this._isAG;
    };

    /**
     * 
     * @param {Node} n 
     * @returns {Skeleton}
     */
    CharacterController.prototype._findSkel = function (n) {
        var root = this._root(n);
        if (root instanceof BABYLON.Mesh && root.skeleton)
            return root.skeleton;
        //find all child meshes which have skeletons
        var ms = root.getChildMeshes(false, function (cm) {
            if (cm instanceof BABYLON.Mesh) {
                if (cm.skeleton) {
                    return true;
                }
            }
            return false;
        });
        //return the skeleton of the first child mesh
        if (ms.length > 0)
            return ms[0].skeleton;
        else
            return null;
    };
    /**
     * 
     * @param {Node} tn 
     * @returns {Node}
     */
    CharacterController.prototype._root = function (tn) {
        if (tn.parent == null)
            return tn;
        return this._root(tn.parent);
    };
    /**
     * 
     * @param {Mesh} avatar 
     * @param {boolean} faceForward 
     * @returns {boolean}
     */
    CharacterController.prototype.setAvatar = function (avatar, faceForward) {
        if (faceForward === void 0) { faceForward = false; }
        var rootNode = this._root(avatar);
        if (rootNode instanceof BABYLON.Mesh) {
            this._avatar = rootNode;
        }
        else {
            console.error("Cannot move this mesh. The root node of the mesh provided is not a mesh");
            return false;
        }
        this._skeleton = this._findSkel(avatar);
        this._isAG = this._containsAG(avatar, this._scene.animationGroups, true);
        this._actionMap.reset();

        //animation ranges

        if (!this._isAG && this._skeleton != null)
            this._checkAnimRanges(this._skeleton);

        this._setRHS(avatar);
        this.setFaceForward(faceForward);
        return true;
    };
    CharacterController.prototype.getAvatar = function () {
        return this._avatar;
    };
    // force a skeleton to be the avatar skeleton
    // should not be calling this normally
    CharacterController.prototype.setAvatarSkeleton = function (skeleton) {
        this._skeleton = skeleton;
        if (this._skeleton != null && this._skelDrivenByAG(skeleton))
            this._isAG = true;
        else
            this._isAG = false;
        if (!this._isAG && this._skeleton != null)
            this._checkAnimRanges(this._skeleton);
    };
    // this check if any of this skeleton animations is referenced by any targetedAnimation in any of the animationgroup in the scene.
    CharacterController.prototype._skelDrivenByAG = function (skeleton) {
        var _this = this;
        return skeleton.animations.some(function (sa) { return _this._scene.animationGroups.some(function (ag) { return ag.children.some(function (ta) { return ta.animation == sa; }); }); });
    };
    CharacterController.prototype.getSkeleton = function () {
        return this._skeleton;
    };
    return CharacterController;
}());

var _Action = /** @class */ (function () {
    function _Action() {
        this._walk = false;
        this._walkback = false;
        this._turnRight = false;
        this._turnLeft = false;
        this._stepRight = false;
        this._stepLeft = false;
        this._jump = false;
        /*
        this._death = false;
        this._point = false;
        this._swingRight = false;
        */
        // speed modifier - changes speed of movement
        this._speedMod = false;
        this.reset();
    }
    _Action.prototype.reset = function () {
        this._walk = false;
        this._walkback = false;
        this._turnRight = false;
        this._turnLeft = false;
        this._stepRight = false;
        this._stepLeft = false;
        this._jump = false;
        /*
        this._death = false;
        this._point = false;
        this._swingRight = false;
        */
        this._speedMod = false;
    };
    return _Action;
}());

var ActionData = /** @class */ (function () {
    /**
     * 
     * @param {string} id 
     * @param {number} speed 
     * @param {string} key 
     */
    function ActionData(id, speed, key) {
        if (speed === void 0) { speed = 1; }
        //animation data
        //if _ag is null then assuming animation range and use _name to play animationrange
        //instead of name maybe call it arName?
        this.name = "";
        this.loop = true;
        this.rate = 1;
        this.exist = false;
        this.id = id;
        this.speed = speed;
        this.ds = speed;
        this.key = key;
        this.dk = key;
    }
    ActionData.prototype.reset = function () {
        this.name = "";
        this.speed = this.ds;
        this.key = this.dk;
        this.loop = true;
        this.rate = 1;
        this.sound = null;
        this.exist = false;
    };
    return ActionData;
}());

//not really a "Map"
var ActionMap = /** @class */ (function () {
    function ActionMap() {
        this.walk = new ActionData("walk", 3, "w");
        this.walkBack = new ActionData("walkBack", 1.5, "s");
        this.walkBackFast = new ActionData("walkBackFast", 3, "na");
        this.idle = new ActionData("idle", 0, "na");
        this.idleJump = new ActionData("idleJump", 6, " ");
        this.run = new ActionData("run", 6, "na");
        this.runJump = new ActionData("runJump", 6, "na");
        this.fall = new ActionData("fall", 0, "na");
        this.turnLeft = new ActionData("turnLeft", Math.PI / 8, "a");
        this.turnLeftFast = new ActionData("turnLeftFast", Math.PI / 4, "na");
        this.turnRight = new ActionData("turnRight", Math.PI / 8, "d");
        this.turnRightFast = new ActionData("turnRightFast", Math.PI / 4, "na");
        this.strafeLeft = new ActionData("strafeLeft", 1.5, "q");
        this.strafeLeftFast = new ActionData("strafeLeftFast", 3, "na");
        this.strafeRight = new ActionData("strafeRight", 1.5, "e");
        this.strafeRightFast = new ActionData("strafeRightFast", 3, "na");
        this.slideBack = new ActionData("slideBack", 0, "na");
        /*
        this.death = new ActionData("death", 0, "-");
        this.swingRight = new ActionData("swingRight", 0, "f");
        this.point = new ActionData("point", 0, "p");
        */
    }
    ActionMap.prototype.reset = function () {
        var keys = Object.keys(this);
        for (var _i = 0, keys_6 = keys; _i < keys_6.length; _i++) {
            var key = keys_6[_i];
            var act = this[key];
            if (!(act instanceof ActionData))
                continue;
            act.reset();
        }
    };
    return ActionMap;
}());

var CCSettings = /** @class */ (function () {
    function CCSettings() {
        this.cameraElastic = true;
        this.makeInvisble = true;
        this.cameraTarget = BABYLON.Vector3.Zero();
        this.noFirstPerson = false;
        this.topDown = true;
        //turningOff takes effect only when topDown is false
        this.turningOff = true;
        this.keyboard = true;
    }
    return CCSettings;
}());
