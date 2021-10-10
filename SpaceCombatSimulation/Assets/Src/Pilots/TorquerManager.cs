using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.Pilots
{
    public class TorquerManager : ITorquerManager
    {
        private readonly List<ITorquer> _torquers;
        private readonly Rigidbody _pilot;
        private bool _isActive = true;
        private readonly Transform _torqueVectorArrow;
        public bool Log { get; set; } = false;

        public TorquerManager(Rigidbody pilot, Transform torqueVectorArrow = null)
        {
            _pilot = pilot;
            if(_pilot == null)
            {
                Debug.LogError($"{this} doesn't have a rigidbody set as a pilot.");
                _isActive = false;
            }
            var torquers = _pilot.GetComponentsInChildren<ITorquer>();
            if((torquers?.Length ?? 0) < 1)
            {
                Debug.LogWarning($"{this} on {_pilot} doesn't have any torquers");
                _torquers = new List<ITorquer>();
                _isActive = false;
            }
            else
            {
                _torqueVectorArrow = torqueVectorArrow;
                _torquers = torquers.ToList();
            }
        }

        public void TurnToVectorInWorldSpace(Vector3 lookVector, Vector3? upVector = null)
        {
            if (!_isActive) return;
            RemoveNullTorquers();
            //Debug.Log("vector" + vector);
            var lookVectorInPilotSpace = _pilot.transform.InverseTransformVector(lookVector.normalized);
            float zRotation = 0;
            if (upVector.HasValue)
            {
                var upVectorInPilotSpace = _pilot.transform.InverseTransformVector(upVector.Value);
                zRotation = -upVectorInPilotSpace.x;
            }
            //Debug.Log(_pilot + " vectorInPilotSpace " + vectorInPilotSpace);
            var pilotSpaceTorqueVector = new Vector3(lookVectorInPilotSpace.y, -lookVectorInPilotSpace.x, zRotation);
            if (NeedsToTurnRightArround(lookVectorInPilotSpace))
            {
                //The target is exactly behind, turning in any direction will do.
                if (Log)
                    Debug.Log("Target is exactly behind");
                pilotSpaceTorqueVector = new Vector3(1, 0, zRotation);
            }
            //Debug.Log("rotationVector" + rotationVector);

            if (Log)
            {
                Debug.Log($"{_pilot} - lookVector = {lookVector}, lookVectorInPilotSpace = {lookVectorInPilotSpace}, pilotSpaceTorqueVector = {pilotSpaceTorqueVector}");
            }
            if (_torqueVectorArrow != null)
            {
                var worldTorque = _pilot.transform.TransformVector(pilotSpaceTorqueVector);
                _torqueVectorArrow.rotation = Quaternion.LookRotation(worldTorque);
                var scale = worldTorque.magnitude;
                _torqueVectorArrow.localScale = new Vector3(scale, scale, scale);
            }
            foreach (var torquer in _torquers)
            {
                torquer.SetTorque(pilotSpaceTorqueVector);
            }
        }

        private static bool NeedsToTurnRightArround(Vector3 lookVectorInPilotSpace)
        {
            var z = lookVectorInPilotSpace.z; // +ve if somewhere in front, -ve if somewhere behind
            var magnitude = lookVectorInPilotSpace.magnitude;   // +ve
            // if the absolute value of z is nearly as big as the magnitude of the vector, x and y must have small magnitudes.
            // If z is negative, the vector points backwards.
            // if z is -ve and nearly as big as the magnitude, must be pointing almost exactly backwards.

            return z <= -magnitude * 0.9;
        }

        public void Activate()
        {
            if (_torquers.Any())
            {
                _isActive = true;
                RemoveNullTorquers();
                foreach (var torquer in _torquers)
                {
                    torquer.Activate();
                }
            }
        }

        public void Deactivate()
        {
            _isActive = false;
            if (_torquers.Any())
            {
                RemoveNullTorquers();
                foreach (var torquer in _torquers)
                {
                    torquer.Deactivate();
                }
            }
        }

        private void RemoveNullTorquers()
        {
            _torquers.RemoveAll(t => t?.IsActiveTorquer != true);
        }
    }
}
