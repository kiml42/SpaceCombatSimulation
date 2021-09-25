using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.Pilots
{
    public class MultiTorquerTorqueAplier : ITorqueApplier, IDeactivatable
    {
        private List<Rigidbody> _torquers = new List<Rigidbody>();
        public float TorqueMultiplier;
        public float AngularDragWhenActive;
        private readonly Rigidbody _pilot;
        private Dictionary<Transform, Vector3> _engineTorquers = new Dictionary<Transform, Vector3>();

        public MultiTorquerTorqueAplier(Rigidbody pilot, Rigidbody torquer, float torqueMultiplier, float angularDragWhenActive)
        {
            _pilot = pilot;
            _torquers = new List<Rigidbody> { torquer };
            TorqueMultiplier = torqueMultiplier;
            AngularDragWhenActive = angularDragWhenActive;
        }

        public MultiTorquerTorqueAplier(Rigidbody pilotAndTorquer, float torqueMultiplier, float angularDragWhenActive)
        {
            _pilot = pilotAndTorquer;
            _torquers = new List<Rigidbody> { pilotAndTorquer };
            TorqueMultiplier = torqueMultiplier;
            AngularDragWhenActive = angularDragWhenActive;
        }

        public MultiTorquerTorqueAplier(Rigidbody pilot, List<Rigidbody> torquers, float torqueMultiplier, float angularDragWhenActive)
        {
            _pilot = pilot;
            _torquers = torquers;
            TorqueMultiplier = torqueMultiplier;
            AngularDragWhenActive = angularDragWhenActive;
        }

        public void TurnToVectorInWorldSpace(Vector3 lookVector, Vector3? upVector = null)
        {
            RemoveNullTorquers();
            RemoveDeadEngines();
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
                var localSpaceVector = torquer.transform.InverseTransformVector(worldTorque).normalized;    //transform vector to torquer space
                torquer.AddRelativeTorque(TorqueMultiplier * localSpaceVector); //apply torque to torquer
            }
        }

        public void AddTorquer(Rigidbody torquer)
        {
            _torquers.Add(torquer);
            RemoveNullTorquers();
        }

        public void Activate()
        {
            RemoveNullTorquers();
            foreach (var torquer in _torquers)
            {
                torquer.angularDrag = AngularDragWhenActive;
            }
        }

        public void Deactivate()
        {
            RemoveNullTorquers();
            foreach (var torquer in _torquers)
            {
                torquer.angularDrag = 0;
            }
        }

        private void RemoveNullTorquers()
        {
            _torquers = _torquers.Where(t => t != null).Distinct().ToList();
        }

        private void RemoveDeadEngines()
        {
            _engineTorquers = _engineTorquers.Where(p => p.Key.IsValid()).ToDictionary(p => p.Key, p => p.Value);
        }
    }
}
