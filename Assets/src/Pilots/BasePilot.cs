using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using Assets.Src.Targeting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Pilots
{
    public abstract class BasePilot : IPilot
    {
        public float CloseEnoughAngle = 0;

        public float LocationAimWeighting { get; set; }
        public Transform VectorArrow;

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

        protected bool ShouldTurn()
        {
            //Debug.Log("TurningStartDelay:" + TurningStartDelay);
            TurningStartDelay -= Time.deltaTime;
            StartDelay -= Time.deltaTime;
            return TurningStartDelay <= 0;
        }

        protected ITorqueApplier _torqueApplier;

        protected Rigidbody _pilotObject;

        protected bool HasStarted()
        {
            //Debug.Log("StartDelay: " + StartDelay);
            var hasStarted = StartDelay <= 0;
            if (!hasStarted)
            {
                //Debug.Log("hasn't started");
                _torqueApplier.Deactivate();
            }
            else
            {
                //Debug.Log("has started");
                _torqueApplier.Activate();
            }
            //Debug.Log("hasStarted: " + hasStarted);
            return hasStarted;
        }

        protected Vector3 ReletiveLocationInWorldSpace(Target target)
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

        protected Vector3 VectorToCancelLateralVelocityInWorldSpace(Target target)
        {
            var vectorTowardsTarget = ReletiveLocationInWorldSpace(target);
            var targetReletiveVelocity = WorldSpaceReletiveVelocityOfTarget(target);

            return targetReletiveVelocity.ComponentPerpendicularTo(vectorTowardsTarget);
        }

        protected Vector3 WorldSpaceReletiveVelocityOfTarget(Target target)
        {
            if (target == null)
            {
                return Vector3.zero;
            }
            return WorldSpaceReletiveVelocityOfTarget(target.Rigidbody);
        }

        protected Vector3 WorldSpaceReletiveVelocityOfTarget(Rigidbody target)
        {
            var targetsVelocity = target == null ? Vector3.zero : target.velocity;
            var ownVelocity = _pilotObject.velocity;
            return targetsVelocity - ownVelocity;
        }

        protected void SetFlightVectorOnEngines(Vector3? flightVector)
        {
            foreach (var engine in _engines)
            {
                engine.FlightVector = flightVector;
            }
        }

        protected void SetTurningVectorOnEngines(Vector3? torqueVector)
        {
            foreach (var engine in _engines)
            {
                engine.OrientationVector = torqueVector;
            }
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

        public abstract void Fly(Target target);
    }
}
