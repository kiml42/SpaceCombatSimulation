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

        public TorquerManager(Rigidbody pilot)
        {
            _pilot = pilot;
            if(_pilot == null)
            {
                Debug.LogError($"{this} doesn't have a rigidbody set as a pilot.");
            }
            var torquers = _pilot.GetComponentsInChildren<ITorquer>();
            if((torquers?.Length ?? 0) < 1)
            {
                Debug.LogWarning($"{this} on {_pilot} doesn't have any torquers");
                _torquers = new List<ITorquer>();
            }
            else
            {
                _torquers = torquers.ToList();
            }
        }

        public void TurnToVectorInWorldSpace(Vector3 lookVector, Vector3? upVector = null)
        {
            RemoveNullTorquers();
            //Debug.Log("vector" + vector);
            var lookVectorInPilotSpace =  _pilot.transform.InverseTransformVector(lookVector);
            float zRotation = 0;
            if (upVector.HasValue)
            {
                var upVectorInPilotSpace =  _pilot.transform.InverseTransformVector(upVector.Value);
                zRotation = -upVectorInPilotSpace.x;
            }
            //Debug.Log(_pilot + " vectorInPilotSpace " + vectorInPilotSpace);
            var rotationVector = new Vector3(-lookVectorInPilotSpace.y, lookVectorInPilotSpace.x, zRotation);   //set z to 0 to not add spin
            if(lookVectorInPilotSpace.y < 0.1 && lookVectorInPilotSpace.x < 0.1 && lookVectorInPilotSpace.z < 0)
            {
                //The target is exactly behind, turning in any direction will do.
                //Debug.Log("Target is exactly behind");
                rotationVector = new Vector3(1, 0, zRotation);
            }
            //Debug.Log("rotationVector" + rotationVector);

            var worldTorque = _pilot.transform.TransformVector(rotationVector).normalized;
            foreach (var torquer in _torquers)
            {
                torquer.SetTorque(worldTorque);
            }
        }

        public void Activate()
        {
            RemoveNullTorquers();
            foreach (var torquer in _torquers)
            {
                torquer.Activate();
            }
        }

        public void Deactivate()
        {
            RemoveNullTorquers();
            foreach (var torquer in _torquers)
            {
                torquer.Deactivate();
            }
        }

        private void RemoveNullTorquers()
        {
            _torquers.RemoveAll(t => t == null);
        }
    }
}
