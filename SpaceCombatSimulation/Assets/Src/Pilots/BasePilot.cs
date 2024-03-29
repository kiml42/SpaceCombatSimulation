﻿using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Pilots
{
    public abstract class BasePilot : IPilot
    {
        public bool Log = false;

        public float RadialSpeedWeighting { get; set; }
        public Transform OrientationVectorArrow;
        public Transform AccelerationVectorArrow;

        public float StartDelay
        {
            get
            {
                return _startDelay;
            }
            set
            {
                _startDelay = value;
            }
        }

        public float TurningStartDelay
        {
            get
            {
                return _turningStartDelay;
            }
            set
            {
                _turningStartDelay = value;
            }
        }
        private float _startDelay = 0;
        private float _turningStartDelay;

        protected List<EngineControler> _engines = new List<EngineControler>();

        protected bool HasActivated()
        {
            //Debug.Log("TurningStartDelay:" + TurningStartDelay);
            TurningStartDelay -= Time.fixedDeltaTime;
            StartDelay -= Time.fixedDeltaTime;
            return TurningStartDelay <= 0;
        }

        protected ITorquerManager _torqueApplier;

        protected Rigidbody _pilotObject;

        private ITarget _pilotTarget;
        public ITarget PilotTarget
        {
            get
            {
                if (_pilotTarget == null)
                {
                    _pilotTarget = _pilotObject.GetComponent<ITarget>();
                }
                return _pilotTarget;
            }
        }


        protected bool HasStarted()
        {
            //Debug.Log("StartDelay: " + StartDelay);
            var hasStarted = StartDelay <= 0;
            if (!hasStarted)
            {
                if(Log)
                    Debug.Log("hasn't started");
                _torqueApplier.Deactivate();
            }
            else
            {
                if (Log)
                    Debug.Log("has started");
                _torqueApplier.Activate();
            }
            //Debug.Log("hasStarted: " + hasStarted);
            return hasStarted;
        }

        protected Vector3 RelativeLocationInWorldSpace(ITarget target)
        {
            if (_pilotObject != null && target != null && target.Transform.IsValid())
            {
                var location = target.Transform.position - _pilotObject.position;
                return location;
            }

            //if (target == null || target.Transform.IsInvalid())
            //{
            //    Debug.Log("Target transform is invalid");
            //}
            if (_pilotObject == null)
            {
                Debug.Log("_pilotObject is null");
            }
            return Vector3.zero;
        }

        protected Vector3 VectorToCancelLateralVelocityInWorldSpace(ITarget target)
        {
            var vectorTowardsTarget = RelativeLocationInWorldSpace(target);
            var targetRelativeVelocity = WorldSpaceRelativeVelocityOfTarget(target);

            return targetRelativeVelocity.ComponentPerpendicularTo(vectorTowardsTarget);
        }

        protected Vector3 WorldSpaceRelativeVelocityOfTarget(ITarget target)
        {
            if (target == null)
            {
                return Vector3.zero;
            }
            return WorldSpaceRelativeVelocityOfTarget(target.Rigidbody);
        }

        protected Vector3 WorldSpaceRelativeVelocityOfTarget(Rigidbody target)
        {
            var targetsVelocity = target == null ? Vector3.zero : target.velocity;
            var ownVelocity = _pilotObject.velocity;
            return targetsVelocity - ownVelocity;
        }

        protected void SetPrimaryTranslationVectorOnEngines(Vector3? primaryTranslateVector)
        {
            foreach (var engine in _engines)
            {
                engine.PrimaryTranslateVector = primaryTranslateVector;
            }
        }

        protected void SetSecondaryTranslateVectorOnEngines(Vector3? secondaryTranslateVector)
        {
            foreach (var engine in _engines)
            {
                engine.SecondaryTranslateVector = secondaryTranslateVector;
            }
        }

        protected void RemoveNullEngines()
        {
            _engines = _engines.Where(t => t != null).Distinct().ToList();
        }
        
        public void AddEngine(EngineControler engine)
        {
            _engines.Add(engine);
        }

        public abstract void Fly(ITarget target);
    }
}
